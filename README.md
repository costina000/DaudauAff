# Đậu Đậu Affiliate

Trang landing page sản phẩm affiliate cho TikTok/Facebook của Đậu Đậu Family.

## Cấu trúc

- `index.html` — giao diện và logic hiển thị.
- `style.css` — giao diện responsive, ưu tiên mobile.
- `products.json` — danh sách sản phẩm; chỉ cần sửa file này để cập nhật tên, ảnh, mô tả, giá và link.

## Thêm sản phẩm

Mỗi sản phẩm có các trường:

```json
{
  "name": "Tên sản phẩm",
  "category": "Danh mục",
  "description": "Mô tả ngắn",
  "price": "199.000đ",
  "image": "images/san-pham.jpg",
  "link": "https://..."
}
```

Có thể để `image` trống để hiển thị biểu tượng mẫu.

## GitHub Pages

Trong **Settings → Pages**, chọn **Deploy from a branch**, branch `main`, folder `/ (root)`, rồi Save.

Sau khi GitHub Pages deploy xong, URL sẽ có dạng:

`https://costina000.github.io/DaudauAff/`

## Ghi chú

Đây là website tĩnh, không cần hosting trả phí hay backend. Khi có ảnh sản phẩm thật, đặt ảnh trong thư mục `images/` và cập nhật đường dẫn trong `products.json`.
