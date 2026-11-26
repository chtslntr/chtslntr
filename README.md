# Hisse Defteri

Şirketlerin ortaklık yapısını (cap table) yönetmek için basit bir web uygulaması.

## Özellikler

- **Özet:** Tam seyreltilmiş pay, son pay fiyatı, zımni değerleme, kategoriye göre sahiplik grafiği ve ortaklık tablosu (CSV olarak indirilebilir)
- **Hissedarlar:** Kurucu, yatırımcı, çalışan ve diğer kategorilerinde hissedar yönetimi
- **İşlemler:** Pay ihracı ve opsiyon hibelerinin kaydı (adet, fiyat, tarih, not)
- **Tur simülasyonu:** Yatırım öncesi değerleme, yatırım tutarı ve hedef opsiyon havuzuna göre seyrelmeyi hesaplar ve sonucu tabloya uygular
- **Ayarlar:** Şirket bilgileri, para birimi, opsiyon havuzu, pay sınıfları, JSON yedekleme/geri yükleme
- Açık/koyu tema, mobil uyumlu

Veriler yalnızca tarayıcının `localStorage` alanında tutulur, herhangi bir sunucuya gönderilmez.

## Çalıştırma

Derleme adımı yoktur. `index.html` dosyasını tarayıcıda açmanız yeterli.

## Yayınlama (GitHub Pages)

Depo ayarlarında **Settings → Pages → Build and deployment → Deploy from a branch** seçip
yayınlamak istediğiniz dalı ve `/ (root)` klasörünü seçin.
