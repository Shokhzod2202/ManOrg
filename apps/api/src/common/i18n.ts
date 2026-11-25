/**
 * Phase 3 languages for text the server sends (phone push, Telegram, the arrival reminder). The
 * English template is the key; a missing translation falls back to English. `{name}` parts are
 * filled after translating, so names and numbers are never translated.
 */
export type Locale = 'en' | 'ko' | 'uz';

const KO: Record<string, string> = {
  'New task: <b>{title}</b>\nDue {due}': '새 업무: <b>{title}</b>\n마감 {due}',
  'New task: <b>{title}</b>': '새 업무: <b>{title}</b>',
  'Task done with a photo: <b>{title}</b>': '사진과 함께 완료된 업무: <b>{title}</b>',
  'A contractor applied to order from you.': '거래처가 주문을 신청했습니다.',
  'Someone applied to join as an employee.': '누군가 직원으로 가입을 신청했습니다.',
  'Your application was approved. You can sign in and start.':
    '신청이 승인되었습니다. 로그인해서 시작하세요.',
  'Your application was not approved.': '신청이 승인되지 않았습니다.',
  'Ingredient order: <b>{name}</b> × {quantity} packs': '재료 주문: <b>{name}</b> × {quantity}포장',
  'An ingredient order was bought. Check it when it arrives.':
    '재료 주문을 구매했습니다. 도착하면 확인하세요.',
  'Order today: <b>{name}</b>': '오늘 주문: <b>{name}</b>',
  'A contractor placed an order.': '거래처가 주문했습니다.',
  'Your order was changed by the bakery.': '빵집이 주문을 변경했습니다.',
  '<b>{name}</b>, {date}: {message}': '<b>{name}</b>, {date}: {message}',
  'Your shift correction for <b>{date}</b> was approved.':
    '<b>{date}</b> 근무 수정 요청이 승인되었습니다.',
  'Your shift correction for <b>{date}</b> was not approved.':
    '<b>{date}</b> 근무 수정 요청이 승인되지 않았습니다.',
  'Change accepted: <b>{product}</b> now {quantity}':
    '변경 수락: <b>{product}</b> 이제 {quantity}개',
  'Change not accepted: <b>{product}</b>': '변경 거절: <b>{product}</b>',
  'A contractor confirmed a payment of <b>{amount} won</b>. Review it in Finance.':
    '거래처가 <b>{amount}원</b> 입금을 확인했습니다. 정산에서 검토하세요.',
  'Your payment of <b>{amount} won</b> was approved.': '<b>{amount}원</b> 입금이 승인되었습니다.',
  'Your payment of <b>{amount} won</b> was not approved: {reason}':
    '<b>{amount}원</b> 입금이 승인되지 않았습니다: {reason}',
  'A payment of <b>{amount} won</b> was reversed: {reason}':
    '<b>{amount}원</b> 입금이 취소되었습니다: {reason}',
  'Settlement {start} to {end} is closed. Balance: <b>{amount} won</b>':
    '{start}~{end} 정산이 마감되었습니다. 잔액: <b>{amount}원</b>',
  'Delivery for <b>{date}</b> is done. Please confirm it.':
    '<b>{date}</b> 배송이 완료되었습니다. 확인해 주세요.',
  'A contractor asked to change a delivery.': '거래처가 배송 변경을 요청했습니다.',
  'Your delivery change was approved.': '배송 변경이 승인되었습니다.',
  'Your delivery change was not approved.': '배송 변경이 승인되지 않았습니다.',
  'New delivery time: about <b>{start}–{end}</b>': '새 배송 시간: 약 <b>{start}–{end}</b>',
  'You came to work. Start shift': '출근했어요. 근무를 시작하세요',
  'Reset your Haydar Systems password': 'Haydar Systems 비밀번호 재설정',
  'Hello {name},\n\nSomeone asked to reset the password of your Haydar Systems account. To choose a new password, open this link within {minutes} minutes:\n\n{link}\n\nIf it was not you, ignore this email: your password stays the same.':
    '{name}님, 안녕하세요.\n\nHaydar Systems 계정의 비밀번호 재설정 요청이 있었습니다. 새 비밀번호를 정하려면 {minutes}분 안에 이 링크를 여세요:\n\n{link}\n\n본인이 요청하지 않았다면 이 이메일을 무시하세요. 비밀번호는 바뀌지 않습니다.',
  'Your Haydar Systems password was changed': 'Haydar Systems 비밀번호가 변경되었습니다',
  'Hello {name},\n\nThe password of your Haydar Systems account was just changed with a reset link, and you were signed out everywhere. If it was not you, reset your password again and tell your admin.':
    '{name}님, 안녕하세요.\n\n재설정 링크로 Haydar Systems 계정의 비밀번호가 방금 변경되었고 모든 기기에서 로그아웃되었습니다. 본인이 아니라면 비밀번호를 다시 재설정하고 관리자에게 알려 주세요.',
};

const UZ: Record<string, string> = {
  'New task: <b>{title}</b>\nDue {due}': 'Yangi vazifa: <b>{title}</b>\nMuddat {due}',
  'New task: <b>{title}</b>': 'Yangi vazifa: <b>{title}</b>',
  'Task done with a photo: <b>{title}</b>': 'Vazifa surat bilan bajarildi: <b>{title}</b>',
  'A contractor applied to order from you.': 'Mijoz sizdan buyurtma berish uchun ariza berdi.',
  'Someone applied to join as an employee.': 'Kimdir xodim sifatida qoʻshilish uchun ariza berdi.',
  'Your application was approved. You can sign in and start.':
    'Arizangiz tasdiqlandi. Kirib, ishni boshlashingiz mumkin.',
  'Your application was not approved.': 'Arizangiz tasdiqlanmadi.',
  'Ingredient order: <b>{name}</b> × {quantity} packs':
    'Masalliq buyurtmasi: <b>{name}</b> × {quantity} qadoq',
  'An ingredient order was bought. Check it when it arrives.':
    'Masalliq buyurtmasi sotib olindi. Kelganda tekshiring.',
  'Order today: <b>{name}</b>': 'Bugun buyurtma qiling: <b>{name}</b>',
  'A contractor placed an order.': 'Mijoz buyurtma berdi.',
  'Your order was changed by the bakery.': 'Novvoyxona buyurtmangizni oʻzgartirdi.',
  '<b>{name}</b>, {date}: {message}': '<b>{name}</b>, {date}: {message}',
  'Your shift correction for <b>{date}</b> was approved.':
    '<b>{date}</b> smenasi uchun tuzatish tasdiqlandi.',
  'Your shift correction for <b>{date}</b> was not approved.':
    '<b>{date}</b> smenasi uchun tuzatish tasdiqlanmadi.',
  'Change accepted: <b>{product}</b> now {quantity}':
    'Oʻzgarish qabul qilindi: <b>{product}</b> endi {quantity}',
  'Change not accepted: <b>{product}</b>': 'Oʻzgarish qabul qilinmadi: <b>{product}</b>',
  'A contractor confirmed a payment of <b>{amount} won</b>. Review it in Finance.':
    'Mijoz <b>{amount} von</b> toʻlovni tasdiqladi. Uni Moliya boʻlimida koʻrib chiqing.',
  'Your payment of <b>{amount} won</b> was approved.':
    '<b>{amount} von</b> toʻlovingiz tasdiqlandi.',
  'Your payment of <b>{amount} won</b> was not approved: {reason}':
    '<b>{amount} von</b> toʻlovingiz tasdiqlanmadi: {reason}',
  'A payment of <b>{amount} won</b> was reversed: {reason}':
    '<b>{amount} von</b> toʻlov bekor qilindi: {reason}',
  'Settlement {start} to {end} is closed. Balance: <b>{amount} won</b>':
    '{start} – {end} hisob-kitobi yopildi. Qoldiq: <b>{amount} von</b>',
  'Delivery for <b>{date}</b> is done. Please confirm it.':
    '<b>{date}</b> yetkazishi bajarildi. Iltimos, tasdiqlang.',
  'A contractor asked to change a delivery.': 'Mijoz yetkazishni oʻzgartirishni soʻradi.',
  'Your delivery change was approved.': 'Yetkazishdagi oʻzgartirishingiz tasdiqlandi.',
  'Your delivery change was not approved.': 'Yetkazishdagi oʻzgartirishingiz tasdiqlanmadi.',
  'New delivery time: about <b>{start}–{end}</b>':
    'Yangi yetkazish vaqti: taxminan <b>{start}–{end}</b>',
  'You came to work. Start shift': 'Ishga keldingiz. Smenani boshlang',
  'Reset your Haydar Systems password': 'Haydar Systems parolini tiklash',
  'Hello {name},\n\nSomeone asked to reset the password of your Haydar Systems account. To choose a new password, open this link within {minutes} minutes:\n\n{link}\n\nIf it was not you, ignore this email: your password stays the same.':
    'Salom, {name}.\n\nHaydar Systems hisobingiz parolini tiklash soʻraldi. Yangi parol tanlash uchun ushbu havolani {minutes} daqiqa ichida oching:\n\n{link}\n\nAgar bu siz boʻlmasangiz, bu xatni eʼtiborsiz qoldiring: parolingiz oʻzgarmaydi.',
  'Your Haydar Systems password was changed': 'Haydar Systems parolingiz oʻzgartirildi',
  'Hello {name},\n\nThe password of your Haydar Systems account was just changed with a reset link, and you were signed out everywhere. If it was not you, reset your password again and tell your admin.':
    'Salom, {name}.\n\nHaydar Systems hisobingiz paroli hozirgina tiklash havolasi orqali oʻzgartirildi va siz barcha qurilmalardan chiqarildingiz. Agar bu siz boʻlmasangiz, parolni yana tiklang va adminingizga xabar bering.',
};

export const SERVER_TEXT: Record<Exclude<Locale, 'en'>, Record<string, string>> = {
  ko: KO,
  uz: UZ,
};

export function translate(
  template: string,
  locale?: string | null,
  vars: Record<string, string> = {},
): string {
  const dict = locale === 'ko' || locale === 'uz' ? SERVER_TEXT[locale] : null;
  const text = dict?.[template] ?? template;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
}
