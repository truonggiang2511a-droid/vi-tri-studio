// Tuyến metro ĐANG THI CÔNG cho cảnh "Hạ tầng đang thi công" (31/10/2026, Giang chọn phương án A).
// Chỉ đưa tuyến ĐÃ thi công thật + vị trí ga đã có trên bản đồ. Không đưa tuyến mới khởi công trên giấy / đang làm
// nghiên cứu khả thi / chưa chốt hướng tuyến (vị trí ga còn đổi → ghi "ga cách nhà … m" dễ thành thông tin sai trong quảng cáo).
// Bản đồ OpenFreeMap mà app dùng KHÔNG có metro đang xây (railway=construction không vào ô bản đồ) nên phải giữ danh sách tay.
// Toạ độ ga: OpenStreetMap, tra qua Nominatim 31/10/2026 (nút railway=stop subway=yes, hoặc công trường ga landuse=construction).
// Hướng tuyến = nối thẳng các ga theo thứ tự (gần đúng, đủ cho khung máy cấp quận).
// [tên ga, lat, lng, cờ]: cờ 'run' = ga đã chạy (chỉ để vẽ nối tuyến, không tính là "ga đang thi công");
//                         'approx' = vị trí ước theo công trường (chưa có nút ga trên OSM).
// Tuyến bắt đầu khai thác → chuyển ga sang js/hubs.js (điểm mốc 'metro') và xoá khỏi đây.
export const METRO_BUILD = [
  {
    id: 'hcm-m2', line: 'Metro số 2', label: 'Metro số 2 Bến Thành – Tham Lương',
    // Khởi công 15/1/2026 (MAUR). 10 ga ngầm + 1 ga trên cao (Tân Bình).
    stations: [
      ['Bến Thành', 10.77092, 106.69803],
      ['Tao Đàn', 10.77320, 106.69025],
      ['Dân Chủ', 10.77780, 106.68166],
      ['Hòa Hưng', 10.78200, 106.67388],
      ['Lê Thị Riêng', 10.78624, 106.66597],
      ['Phạm Văn Hai', 10.78937, 106.66006],
      ['Bảy Hiền', 10.79292, 106.65340],
      ['Nguyễn Hồng Đào', 10.79805, 106.64378],
      ['Bà Quẹo', 10.80484, 106.63553],
      ['Phạm Văn Bạch', 10.81286, 106.63308],
      ['Tân Bình', 10.82196, 106.63024],
    ],
  },
  {
    id: 'hn-m3n', line: 'Metro số 3', label: 'Metro số 3 đoạn ngầm Cầu Giấy – ga Hà Nội',
    // Đoạn trên cao Nhổn – Cầu Giấy chạy từ 8/2024; 4 ga ngầm đang thi công (~80% tiến độ 2026), dự kiến khai thác 2027.
    stations: [
      ['Cầu Giấy', 21.02922, 105.80336, 'run'],
      ['Kim Mã', 21.03073, 105.81423],
      ['Cát Linh', 21.02924, 105.82875],
      ['Văn Miếu', 21.02665, 105.83664],
      ['Ga Hà Nội', 21.02510, 105.84250, 'approx'],
    ],
  },
];
