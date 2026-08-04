# Törnük Derneği — Aidat Sorgulama

Üyelerin T.C. kimlik numarası ile aidat borçlarını sorgulayabileceği, **GitHub Pages** üzerinden ücretsiz yayınlanabilen bir web uygulaması.

Adres örneği: `https://tornukdernek1.github.io/tornuk-dernegi/`

## Özellikler

- T.C. kimlik no doğrulama
- Aidat borcu, borçlu aylar ve son ödeme bilgisi
- TC numaraları repoda **hash**lenerek saklanır (düz metin yok)
- Mobil uyumlu arayüz
- **Uygulamayı İndir** ile ana ekrana ekleme (PWA)
  - Android Chrome: tek dokunuşla kurulum istemi
  - iPhone Safari: Paylaş → Ana Ekrana Ekle adımları gösterilir
  - Not: iOS güvenlik nedeniyle sessiz/otomatik eklemeye izin vermez

## Hızlı başlangıç

```bash
npm install
npm run generate-data
npm run dev
```

Tarayıcıda `http://localhost:5173` açılır.

### Demo TC numaraları (örnek veri)

| TC           | Durum        |
| ------------ | ------------ |
| 10000000146  | 300 ₺ borç   |
| 12345678950  | Güncel       |
| 23456789060  | 200 ₺ borç   |

## Yönetim paneli (admin)

Adres: `https://tornukdernek1.github.io/tornuk-dernegi/#admin`  
Yerelde: `http://localhost:5173/#admin`  

Uygulama içinden: **Menü → Özet → Yönetim paneli**

PIN hash’i `public/data/admin.json` içindedir. Değiştirmek için:

```bash
node -e "const {createHash}=require('crypto'); console.log(createHash('sha256').update('tornuk-admin-v1:YENI_PIN').digest('hex'))"
```

Çıkan hash’i `admin.json` → `passwordHash` alanına yazın.

### Panelden yapılabilecekler
- **Aidat:** Excel/CSV ile toplu üye aktarımı, ödeme işle, borç güncelle, üye ekle/sil
- **Duyurular:** ekle / düzenle / sil
- **Etkinlikler:** ekle / düzenle / sil
- **Kaydet:** JSON indir veya GitHub’a yaz (Personal Access Token ile)

### Excel / CSV aktarım
Admin → Aidat → **Şablon CSV indir** veya kendi Excel dosyanızı yükleyin.

| Sütun | Zorunlu | Örnek |
| --- | --- | --- |
| tc | Evet | 10000000146 |
| ad_soyad | Evet | Ahmet Yılmaz |
| borc_tutari | Hayır | 300 |
| borclu_aylar | Hayır | 2026-05;2026-06 |
| son_odeme | Hayır | 2026-04-10 |
| not | Hayır | Güncel |
| yil_gecmis | Hayır | 2025:odendi;2026:borclu:300 |

Aktarım sonrası **Kaydet** ile yayınlayın.

GitHub’a kaydetmek için token’da `contents: write` yetkisi olsun. Site GitHub Actions ile yayınlanıyorsa push sonrası otomatik güncellenir.

## İçerik güncelleme

Tüm üye içerikleri `public/data/` altındaki JSON dosyalarındadır:

| Dosya | İçerik |
| --- | --- |
| `duyurular.json` | Duyurular (en üstteki = en yeni) |
| `etkinlikler.json` | Etkinlikler |
| `dernek.json` | Adres, yönetim, IBAN, belgeler, SSS |
| `uyeler.json` | Aidat verisi (`npm run generate-data` ile üretilir) |

Yeni duyuru eklerken `items` dizisinin **en başına** ekleyin ve benzersiz bir `id` verin. Bildirimleri açmış üyeler uygulamayı açtıklarında / arka plan kontrolünde uyarı alır.

Belgeler: `public/belgeler/` klasörüne HTML veya PDF koyup `dernek.json` içinden bağlayın.

## Üye listesini güncelleme

1. `data/uyeler.ornek.csv` dosyasını kopyalayın:

```bash
copy data\uyeler.ornek.csv data\uyeler.csv
```

2. Excel veya bir metin editörü ile `data/uyeler.csv` dosyasını doldurun.

| Sütun         | Açıklama                                      | Örnek                    |
| ------------- | --------------------------------------------- | ------------------------ |
| tc            | 11 haneli T.C. kimlik no                      | 10000000146              |
| ad_soyad      | Üye adı soyadı                                | Ahmet Yılmaz             |
| borc_tutari   | Toplam borç (TL)                              | 300                      |
| borclu_aylar  | `YYYY-AA` formatında; `;` ile ayrılmış aylar  | 2026-05;2026-06;2026-07  |
| son_odeme     | Son ödeme tarihi (`YYYY-AA-GG`)               | 2026-04-10               |
| not           | İsteğe bağlı açıklama                         | Ödeme planı görüşülecek |

3. JSON üretin:

```bash
npm run generate-data
```

4. Değişiklikleri GitHub’a gönderin. GitHub Actions siteyi otomatik yayınlar.

> **Önemli:** Gerçek TC içeren `data/uyeler.csv` dosyasını GitHub’a yüklemeyin. Yalnızca üretilen `public/data/uyeler.json` dosyası yayınlanır.

## GitHub Pages ile yayınlama

1. GitHub’da yeni bir depo oluşturun (ör. `tornuk-dernegi`).
2. Bu projeyi depoya yükleyin.
3. Depo ayarlarında **Settings → Pages → Source** olarak **GitHub Actions** seçin.
4. `main` dalına push edin; birkaç dakika içinde site yayında olur.

Depo adınız `tornuk-dernegi` değilse `vite.config.ts` içindeki varsayılan `repoName` değerini kendi depo adınızla değiştirin.

### Elle yayın (Actions kullanmadan)

```bash
npm run deploy
```

Bu komut `gh-pages` dalına yayınlar. Pages kaynağını **Deploy from a branch → gh-pages** olarak seçmeniz gerekir.

## Aylık aidat tutarı

Varsayılan aylık aidat `scripts/generate-data.mjs` içinde `monthlyFee` alanından ayarlanır (şu an `100`).

## Güvenlik notu

Uygulama tamamen tarayıcıda çalışır; ayrı bir sunucu/veritabanı yoktur. TC numaraları SHA-256 ile hashlenir, böylece JSON dosyasında açıkça görünmez. Bu, küçük dernek kullanımı için pratik bir korumadır; banka veya e-Devlet düzeyinde güvenlik değildir. Mümkün olduğunca yalnızca gerekli bilgileri ekleyin.
