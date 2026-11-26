/* Hisse Defteri yapılandırması.
   Supabase bilgileri boş bırakılırsa uygulama "yerel mod"da çalışır: giriş yok,
   veriler yalnızca bu tarayıcıda saklanır.
   Değerleri Supabase panelinde Project Settings → API (Data API) sayfasından alın.
   "anon / publishable" anahtarı herkese açık olacak şekilde tasarlanmıştır; erişim
   veritabanındaki satır bazlı güvenlik kurallarıyla korunur.
   ASLA "service_role / secret" anahtarını buraya yazmayın. */
window.HD_CONFIG = {
  supabaseUrl: 'https://msauyjzopyonapljrwox.supabase.co',
  supabaseAnonKey: 'sb_publishable_xzyBWAd18rORcfe1tf2j6w_nVNUxM-a',
};
