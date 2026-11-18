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
