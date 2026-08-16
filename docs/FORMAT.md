# KPHO container v1

すべての整数は unsigned little-endian です。文字列終端、alignment padding、CRC はありません。

| Offset | Size | Field | Value |
|---:|---:|---|---|
| 0 | 4 | Magic | ASCII `KPHO` |
| 4 | 1 | Version | `1` |
| 5 | 2 | ImageCount | uint16 |

直後に `ImageCount` 個の image record を逐次格納します。

| Record offset | Size | Field | Value |
|---:|---:|---|---|
| 0 | 2 | Width | uint16 |
| 2 | 2 | Height | uint16 |
| 4 | 4 | Length | uint32 |
| 8 | Length | Data | BC1 mip chain |

`ImageCount` は 1〜65535、base の `Width` / `Height` は 4 以上かつ 4 の倍数です。

## BC1 mip chain

- mip level 0 が先頭
- 次の寸法は `max(1, floor(previous / 2))`
- 1×1 を含めて終了
- level byte length は `max(1, ceil(width / 4)) * max(1, ceil(height / 4)) * 8`
- block order は row-major、各 block 内の selector も row-major
- row 0 は Unity texture の下端
- block layout: `color0:uint16`, `color1:uint16`, `selectors:uint32`
- `color0 > color1` の opaque 4-color mode のみ
- RGB565 endpoint と selector は little-endian
- alpha は格納しない

parser は record の不足、余剰 trailing bytes、誤った magic/version、BC1 の期待長不一致を拒否します。
