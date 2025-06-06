import os
import random
import streamlit as st
from dotenv import load_dotenv
from pixivpy3 import AppPixivAPI
from PIL import Image
import requests
from io import BytesIO

# .envからトークン読み込み
load_dotenv()
REFRESH_TOKEN = os.getenv("PIXIV_REFRESH_TOKEN")

st.title("Pixiv Faborite Gallery")

if not REFRESH_TOKEN:
    st.error("PIXIV_REFRESH_TOKENが設定されていません。.envファイルを確認してください。")
    st.stop()

# 取得枚数入力
num_images = st.slider("表示するイラスト枚数", min_value=10, max_value=30, value=20, step=1)

# タグ入力
tags_input = st.text_input("絞り込みたいタグ (カンマ区切り)", "")

# 検索モード選択
search_mode = st.radio("検索モード", ("OR検索", "AND検索"), index=0)

if st.button("ランダム取得"):
    with st.spinner("Pixivから取得中..."):
        api = AppPixivAPI()
        try:
            api.auth(refresh_token=REFRESH_TOKEN)
        except Exception as e:
            st.error(f"Pixiv認証エラー: {e}")
            st.stop()

        # いいねしたイラストを全件取得
        illusts = []
        next_qs = {}
        while True: # next_urlがある限り取得を続ける
            # next_qsにuser_idやrestrictが含まれていれば除外
            filtered_qs = {k: v for k, v in next_qs.items() if k not in ("user_id", "restrict")}
            res = api.user_bookmarks_illust(user_id=api.user_id, restrict="public", **filtered_qs)

            # res.illustsがNoneでないことを確認してからextendを呼び出す
            if res and res.illusts is not None:
                illusts.extend(res.illusts)

            if res and res.next_url:
                # next_urlからクエリパラメータを抽出
                from urllib.parse import urlparse, parse_qs
                qs = parse_qs(urlparse(res.next_url).query)
                next_qs = {k: v[0] for k, v in qs.items()}
            else:
                break

        if not illusts:
            st.warning("いいねしたイラストが見つかりませんでした。")
            st.stop()

        # タグでフィルタリング
        search_tags = [tag.strip().lower() for tag in tags_input.split(',') if tag.strip()]

        if search_tags:
            filtered_illusts = []
            for illust in illusts:
                illust_tags = [tag.name.lower() for tag in illust.tags]
                if search_mode == "OR検索":
                    if any(s_tag in illust_tags for s_tag in search_tags):
                        filtered_illusts.append(illust)
                else: # AND検索
                    if all(s_tag in illust_tags for s_tag in search_tags):
                        filtered_illusts.append(illust)

            if not filtered_illusts:
                st.warning(f"指定されたタグ ({tags_input}) に一致するイラストが見つかりませんでした。")
                st.stop()
        else:
            filtered_illusts = illusts

        # ランダムに選択
        selected = random.sample(filtered_illusts, min(num_images, len(filtered_illusts)))

        # 画像表示（4列×n行で大きく表示）
        import math
        import tempfile
        import os as _os
        from urllib.parse import urlparse
        cols_per_row = 4
        rows = math.ceil(len(selected) / cols_per_row)
        idx = 0
        for r in range(rows):
            cols = st.columns(cols_per_row)
            for c in range(cols_per_row):
                if idx >= len(selected):
                    break
                illust = selected[idx]
                col = cols[c]
                # 全体表示用にmediumサイズURLを使用
                thumb_url = illust.image_urls.medium
                try:
                    with tempfile.TemporaryDirectory() as tmpdir:
                        api.download(thumb_url, path=tmpdir)
                        filename = os.path.basename(urlparse(thumb_url).path)
                        img_path = os.path.join(tmpdir, filename)
                        img = Image.open(img_path)
                        # 画像をクリックでPixivページに遷移するMarkdownリンクとして表示
                        artwork_url = f"https://www.pixiv.net/artworks/{illust.id}"
                        user_url = f"https://www.pixiv.net/users/{illust.user.id}"
                        import base64
                        from io import BytesIO as _BytesIO
                        buffered = _BytesIO()
                        img.save(buffered, format="PNG")
                        img_b64 = base64.b64encode(buffered.getvalue()).decode()
                        # 画像下にタイトル・作者名を配置
                        md = f'''
<div style="text-align:center; padding: 10px 0 18px 0;">
  <a href="{artwork_url}" target="_blank" style="display:inline-block;">
    <img src="data:image/png;base64,{img_b64}" style="width:98%;height:auto;border-radius:8px;box-shadow:0 2px 8px #0001;">
  </a>
  <div style="margin-top:7px;font-weight:600;font-size:1.03em;line-height:1.2;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
    {illust.title}
  </div>
  <div style="font-size:0.93em;color:var(--secondary-text-color,#6a7fa0);margin-top:2px;">
    by <a href="{user_url}" target="_blank" style="color:#2980b9;text-decoration:none;font-weight:500;">{illust.user.name}</a>
  </div>
</div>
'''
                        col.markdown(md, unsafe_allow_html=True)
                except Exception as e:
                    col.write("画像取得失敗")
                    col.write(str(e))
                idx += 1
