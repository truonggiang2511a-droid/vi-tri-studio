// Gói riêng cho bước xuất video (chỉ tải khi khách bấm Xuất): ghép MP4 + bộ mã hoá AAC chạy bằng WebAssembly.
// Dùng AAC WebAssembly trên MỌI máy để file luôn có tiếng (iPhone/Android có trình duyệt không mã hoá được AAC
// hoặc mã hoá thiếu thông tin giải mã → file phát mất tiếng trên Ảnh, Zalo, Facebook).
export { Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedPacket, AudioBufferSource } from 'mediabunny';
export { registerAacEncoder } from '@mediabunny/aac-encoder';
