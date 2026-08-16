# Karei Photo

複数の写真を、Karei Photo で使える `.kphoto` ファイルに変換するWebアプリです。画像処理はすべてブラウザ内で行い、画像データをサーバーへ送信しません。

公開先: <https://nomlasvrc.github.io/KareiPhoto/>

## 使い方

1. 写真を選択するか、画面へドラッグ＆ドロップします。
2. 最大サイズと仕上がりを選び、「変換を開始」を押します。
3. プレビューを確認し、`.kphoto ファイルを保存`を押します。

複数の写真は、ひとつの `.kphoto` ファイルにまとめられます。写真の縦横比は維持されますが、形式上の都合により端が数ピクセル調整される場合があります。透明度は保存されません。

## 起動

Node.js 22 以降で次を実行します。依存パッケージのインストールは不要です。

```powershell
cd Web
npm start
```

`http://127.0.0.1:4173` を開きます。PWA と Web Worker を使うため、`index.html` を直接開かず HTTP サーバー経由で実行してください。

```powershell
npm test
npm run build
```

`npm run build` は GitHub Pages へ公開する静的ファイルを `dist/` へ生成します。

## GitHub Pages へ公開

`.github/workflows/pages.yml` は、`main` ブランチへの push 時に自動テスト、静的サイトの生成、GitHub Pages へのデプロイを行います。Pull Request ではテストとビルドだけを実行し、公開は行いません。

初回のみ、GitHub リポジトリの **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選択してください。その後は `main` への push で公開内容が更新されます。

## 実装内容

- 複数画像選択とドラッグ＆ドロップ
- EXIF Orientation を反映するブラウザ画像デコード
- 最大長辺 512 / 1024 / 2048 / 4096
- 4 の倍数への中央クロップ
- linear-light 面積平均による 1×1 までの mipmap
- opaque 4-color BC1（alpha 無視）
- 高品質／高速モード
- encode→decode 比較、RGB PSNR、輝度重み付き PSNR、時間、サイズ
- KPHO v1 のダウンロード
- Service Worker によるオフライン動作

BC1 高品質モードは、複数 endpoint seed、RGB covariance の PCA、selector 再割り当て、最小二乗 endpoint refinement、RGB565 近傍探索を使います。圧縮は Web Worker 内で行い、複数画像はモバイルのピークメモリを抑えるため逐次処理します。

## 座標と mip 配置

ブラウザ `ImageData` は左上開始ですが、Unity の pixel rows は左下開始です。エンコード時に各 mip を上下反転し、BC1 block row 0 が Unity の下端になるよう格納しています。

mip は level 0 から順に連結し、寸法は `max(1, floor(previous / 2))`。4×4 未満も 8-byte BC1 block を 1 個使います。Unity の `Apply(false, ...)` を使用し、受信側では mip を再生成しません。

## ファイル構成

- `src/bc1.js`: BC1 encoder / decoder とサイズ計算
- `src/mipmap.js`: crop 寸法と linear-light mipmap
- `src/container.js`: KPHO writer / parser
- `src/worker.js`: mipmap と圧縮のバックグラウンド処理
- `src/app.js`: UI、画像デコード、比較、ダウンロード
- `tests/`: 形式、品質、向き、mipmap の自動テスト
- `docs/FORMAT.md`: KPHO v1 の厳密な形式

## 現時点の制約

- Web Share Target のファイル受け取りは未実装です。通常の複数選択とドロップは利用できます。
- EXIF の厳密な挙動は `createImageBitmap(..., imageOrientation: "from-image")` とブラウザの画像デコーダーに依存します。
- BC1 自体が 4 bpp / RGB565 endpoint の不可逆形式なので、色勾配や低彩度面の banding は完全には除去できません。
- 最大品質と 4K の処理速度をさらに上げる次段階は `rgbcx` level 10–18 の専用 WASM backend です。`encodeBc1()` の呼び出し境界で差し替えられます。
