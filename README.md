# Hisse Defteri

Şirketlerin ortaklık yapısını (cap table) yönetmek için basit bir web uygulaması.

## Özellikler

- **Özet:** Tam seyreltilmiş pay, son pay fiyatı, zımni değerleme, kategoriye göre sahiplik grafiği ve ortaklık tablosu (CSV olarak indirilebilir)
- **Hissedarlar:** Kurucu, yatırımcı, çalışan ve diğer kategorilerinde hissedar yönetimi
- **İşlemler:** Pay ihracı ve opsiyon hibelerinin kaydı (adet, fiyat, tarih, not)
- **Vesting:** Pay ve opsiyonlar için aylık hak ediş + cliff takibi; herhangi bir tarih itibarıyla hak edilmiş/edilmemiş paylar
- **Tur simülasyonu:** Yatırım öncesi değerleme, yatırım tutarı ve hedef opsiyon havuzuna göre seyrelmeyi hesaplar ve sonucu tabloya uygular
- **Çıkış analizi:** Satış bedelinin tasfiye tercihlerine (çarpan, katılımlı/katılımsız, kıdem) göre hissedarlara dağılımı; katılımsız imtiyazlı payların dönüşüm kararı ve para dışı opsiyonlar otomatik hesaplanır
- **Ayarlar:** Şirket bilgileri, para birimi, opsiyon havuzu, pay sınıfları, JSON yedekleme/geri yükleme
- **Ekip (bulut modu):** E-posta ile şifresiz giriş, birden fazla şirket, sahip / düzenleyici / izleyici rolleriyle ekip daveti, eşzamanlı düzenleme koruması, sürüm geçmişi ve canlı güncelleme
- Açık/koyu tema, mobil uyumlu

## İki çalışma modu

| | Yerel mod | Bulut modu |
|---|---|---|
| Ne zaman | `config.js` boşsa | `config.js` içinde Supabase bilgileri varsa |
| Giriş | Yok | E-postaya gelen bağlantı ile |
| Veri | Yalnızca bu tarayıcıda (`localStorage`) | Supabase veritabanında, ekiple paylaşılır |
| Şirket sayısı | 1 | Sınırsız; her biri ayrı ekip |

## Çalıştırma

Derleme adımı yoktur. `index.html` dosyasını tarayıcıda açmanız yeterli (yerel mod).

## Bulut modunu kurma (Supabase)

1. [supabase.com](https://supabase.com) üzerinde ücretsiz hesap açın ve **New project** ile bir proje oluşturun
   (bölge olarak size yakın olanı, ör. Frankfurt seçin; veritabanı şifresini güvenli bir yere kaydedin).
2. Sol menüden **SQL Editor → New query** açın, [`supabase/schema.sql`](supabase/schema.sql) dosyasının
   tamamını yapıştırıp **Run** deyin. ("Success. No rows returned" görmelisiniz.)
3. **Authentication → URL Configuration** sayfasında:
   - **Site URL**: sitenizin adresi (GitHub Pages için `https://<kullanıcı-adı>.github.io/<depo-adı>/`)
   - **Redirect URLs**: aynı adresi ekleyin (yerelde deneyecekseniz `http://localhost:8000/` da ekleyin)
4. **Project Settings → API** (ya da **Data API**) sayfasından **Project URL** ve **anon / publishable** anahtarını kopyalayıp
   [`config.js`](config.js) dosyasına yazın. **`service_role` / secret anahtarını asla kullanmayın.**
5. Değişikliği yayınlayın. Siteyi açtığınızda giriş ekranı gelir.

Notlar:
- Supabase'in ücretsiz e-posta gönderimi saatte birkaç e-postayla sınırlıdır. Ekip büyüdüğünde
  **Authentication → Emails → SMTP Settings** bölümünden kendi e-posta sağlayıcınızı bağlayın.
- Ücretsiz projeler bir hafta hiç kullanılmazsa duraklatılır; panelden tek tıkla yeniden başlatılır.
- Davet e-postası gönderilmez: davet edilen kişiye site adresini iletin, aynı e-postayla giriş yaptığında şirkete eklenir.

### Güvenlik modeli

Erişim kuralları tarayıcıda değil, veritabanında satır bazlı güvenlik (RLS) ile uygulanır:

| İşlem | Sahip | Düzenleyici | İzleyici | Üye olmayan |
|---|:-:|:-:|:-:|:-:|
| Şirketi görüntüleme | ✓ | ✓ | ✓ | – |
| Ortaklık tablosunu değiştirme | ✓ | ✓ | – | – |
| Ekip daveti, rol değiştirme, üye çıkarma | ✓ | – | – | – |
| Şirketi silme | ✓ | – | – | – |

Her kayıt bir sürüm numarası taşır; iki kişi aynı anda değişiklik yaparsa ikincisi üzerine yazmak yerine
uyarı alır ve en güncel sürüm yüklenir. Tüm sürümler `company_history` tablosunda saklanır.

## Testler

Hesaplama fonksiyonları (`calc.js`) için:

```bash
node tests/calc.test.js
```

Veritabanı erişim kuralları için (yerel PostgreSQL ile; Supabase'in auth yapısını taklit eder):

```bash
cd supabase/tests && psql -v ON_ERROR_STOP=1 -d <boş-test-veritabanı> -f auth_stub.sql -f ../schema.sql -f rls_test.sql
```

## Yayınlama (GitHub Pages)

1. Depoda **Settings → Pages** sayfasını açın.
2. **Build and deployment → Source**: *Deploy from a branch*.
3. **Branch**: yayınlamak istediğiniz dal (ör. `main`) ve `/ (root)` klasörü → **Save**.
4. Birkaç dakika sonra site `https://<kullanıcı-adı>.github.io/<depo-adı>/` adresinde yayında olur.

GitHub Pages ücretsiz planda yalnızca **herkese açık** depolarda çalışır. Bulut modunda veriler depoda değil
Supabase'de durduğu için deponun herkese açık olması verilerinizi açığa çıkarmaz.
