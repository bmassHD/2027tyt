import firebaseConfig from '../../firebase-applet-config.json';

export function normalizeVietnamPhoneToE164(raw: string): string {
  let cleaned = raw.replace(/[\s\-().]/g, '').trim();
  if (!cleaned) return '';

  if (cleaned.startsWith('0084')) {
    cleaned = `+84${cleaned.slice(4)}`;
  }

  if (/^0\d{9}$/.test(cleaned)) {
    return `+84${cleaned.slice(1)}`;
  }
  if (/^\+84\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^84\d{9}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  return '';
}

export function isValidE164Phone(phone: string): boolean {
  return /^\+84\d{9}$/.test(phone);
}

export function formatFirebaseSmsMfaError(err: any): string {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');

  if (code === 'auth/unverified-email' || msg.includes('unverified-email')) {
    return 'Email tài khoản chưa được xác minh. Vui lòng nhấn "Gửi email xác minh" và xác nhận trong hộp thư Gmail trước khi bật SMS MFA.';
  }
  if (code === 'auth/requires-recent-login' || msg.includes('requires-recent-login')) {
    return 'Phiên đăng nhập đã lâu, cần xác thực lại danh tính trước khi thay đổi bảo mật SMS MFA.';
  }
  if (code === 'auth/invalid-phone-number' || msg.includes('invalid-phone-number')) {
    return 'Số điện thoại không hợp lệ. Bắt buộc gồm đúng 10 chữ số (VD: 0912345678).';
  }
  if (code === 'auth/invalid-verification-code' || msg.includes('invalid-verification-code')) {
    return 'Mã OTP SMS không chính xác. Vui lòng kiểm tra lại tin nhắn.';
  }
  if (code === 'auth/code-expired' || msg.includes('code-expired')) {
    return 'Mã OTP SMS đã hết hạn. Vui lòng yêu cầu gửi lại mã mới.';
  }
  if (code === 'auth/too-many-requests' || msg.includes('too-many-requests')) {
    return 'Bạn đã gửi yêu cầu quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.';
  }
  if (code === 'auth/quota-exceeded' || msg.includes('quota-exceeded')) {
    return 'Hệ thống đã đạt giới hạn gửi tin nhắn SMS trong ngày của dự án Firebase.';
  }
  if (
    code === 'auth/captcha-check-failed' ||
    code === 'auth/invalid-app-credential' ||
    msg.includes('captcha-check-failed') ||
    msg.includes('invalid-app-credential')
  ) {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    return host
      ? `Xác minh reCAPTCHA không thành công. Hãy đảm bảo tên miền "${host}" đã được thêm vào mục Authorized domains (Miền được ủy quyền) trong Firebase Console -> Authentication -> Settings.`
      : 'Xác minh reCAPTCHA không thành công. Hãy tải lại trang hoặc kiểm tra tên miền được cấp phép trong Firebase Console.';
  }
  if (code === 'auth/network-request-failed' || msg.includes('network-request-failed')) {
    return 'Kết nối tới máy chủ Google reCAPTCHA / Firebase bị gián đoạn hoặc hết thời gian chờ. Vui lòng kiểm tra mạng và thử lại.';
  }
  if (code === 'auth/internal-error' || msg.includes('internal-error')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    return host
      ? `Lỗi nội bộ khi khởi tạo xác minh SMS/reCAPTCHA. Kiểm tra tên miền "${host}" trong Authorized domains của Firebase Console và tải lại trang.`
      : 'Lỗi nội bộ khi khởi tạo xác minh SMS/reCAPTCHA. Vui lòng tải lại trang và thử lại.';
  }
  if (code === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
    return 'Phương thức SMS MFA chưa được kích hoạt hoặc vùng số điện thoại này bị hạn chế trong Firebase Console.';
  }
  if (code === 'auth/maximum-second-factor-count-exceeded') {
    return 'Tài khoản đã đạt số lượng phương thức bảo mật 2FA tối đa cho phép.';
  }
  if (code === 'auth/second-factor-already-in-use') {
    return 'Số điện thoại này đã được liên kết làm yếu tố bảo mật 2FA trên tài khoản.';
  }
  if (code === 'auth/popup-closed-by-user') {
    return 'Cửa sổ xác thực Google đã bị đóng trước khi hoàn tất.';
  }
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'Mật khẩu xác thực không chính xác.';
  }
  return err?.message || 'Đã xảy ra lỗi khi xử lý xác thực SMS MFA.';
}

export function formatFirebaseGoogleAuthError(err: any): string {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const projectId = firebaseConfig.projectId || '';
  const authDomain = firebaseConfig.authDomain || '';

  if (
    code === 'auth/unauthorized-domain' ||
    msg.includes('unauthorized-domain') ||
    msg.includes('auth/iframe') ||
    msg.includes('Lỗi không hợp lệ')
  ) {
    return host
      ? `Tên miền "${host}" chưa được thêm vào Authorized domains của dự án Firebase (${projectId} / ${authDomain}) hoặc bản deploy đang dùng cấu hình cũ. Vào Firebase Console → Authentication → Settings → Authorized domains để thêm "${host}" và build/deploy lại bản mới nhất.`
      : `Tên miền hiện tại chưa được cấp phép trong Firebase Console (${projectId}) → Authentication → Settings → Authorized domains.`;
  }
  if (
    code === 'auth/invalid-api-key' ||
    code === 'auth/api-key-not-valid' ||
    msg.includes('api-key-not-valid')
  ) {
    return `API Key Firebase của bản triển khai hiện tại không hợp lệ hoặc bị lệch với dự án "${projectId}". Vui lòng build & deploy lại mã nguồn mới nhất.`;
  }
  if (code === 'auth/popup-blocked') {
    return 'Trình duyệt đang chặn cửa sổ bật lên (Popup) đăng nhập Google. Vui lòng cho phép Popup cho trang web này và thử lại.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Cửa sổ đăng nhập Google đã bị đóng trước khi hoàn tất.';
  }
  if (code === 'auth/operation-not-allowed') {
    return `Phương thức đăng nhập Google chưa được bật trong Firebase Console (${projectId}) → Authentication → Sign-in method.`;
  }
  if (code === 'auth/network-request-failed' || msg.includes('network-request-failed')) {
    return 'Không thể kết nối tới máy chủ xác thực Google / Firebase. Vui lòng kiểm tra kết nối mạng và thử lại.';
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return 'Email này đã được đăng ký bằng phương thức khác. Vui lòng đăng nhập bằng Email/Mật khẩu trước rồi liên kết Google trong mục Bảo mật.';
  }
  if (code === 'auth/credential-already-in-use') {
    return 'Tài khoản Google này đã được liên kết với một tài khoản khác trong hệ thống.';
  }
  if (code === 'auth/requires-recent-login') {
    return 'Phiên đăng nhập đã lâu. Vui lòng đăng xuất và đăng nhập lại trước khi liên kết Google.';
  }
  return err?.message || 'Đăng nhập Google thất bại. Vui lòng thử lại.';
}

