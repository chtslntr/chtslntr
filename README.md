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
- Açık/koyu tema, mobil uyumlu

Veriler yalnızca tarayıcının `localStorage` alanında tutulur, herhangi bir sunucuya gönderilmez.

## Çalıştırma

Derleme adımı yoktur. `index.html` dosyasını tarayıcıda açmanız yeterli.

## Testler

Hesaplama fonksiyonları (`calc.js`) için:

```bash
node tests/calc.test.js
```

## Yayınlama (GitHub Pages)

Depo ayarlarında **Settings → Pages → Build and deployment → Deploy from a branch** seçip
yayınlamak istediğiniz dalı ve `/ (root)` klasörünü seçin.
