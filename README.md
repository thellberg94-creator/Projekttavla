# Projekttavla

Tavla, tidsplan och dokumentationslista för FST-projekt. Alla som är inloggade ser samma data. Appen är en vanlig webbplats utan ramverk, med Supabase för databas och inloggning och Vercel för hosting.

- **Tavla** med sju kolumner (Väntar, Planera in, Redo att utföra, Pågår, Rest och dokumentation, Klar, Akut), dra och släpp, ansvarig tekniker, start och slutbesiktning.
- Kompakta kort med namn, kund, taggar, tekniker och datum. Ikonerna på kortet öppnar (Visa), redigerar och tar bort. Allt annat, och flytt mellan kolumner, finns i Visa-rutan. Akuta kort har röd kant, och slutbesiktning som passerat blir röd (gul inom 14 dagar).
- **Varningsikon** uppe till höger på kort som saknar startdatum eller slutbesiktning (inte i kolumnen Klar). Håll muspekaren över ikonen för att se vad som saknas.
- **Tidplan** per projekt (knapp i Visa-rutan): moment med start och slut som visas som ett Gantt-schema, med projektets start, slutbesiktning och idag markerade.
- **Betalplan** per projekt (knapp i Visa-rutan): kontraktssumma, antal lyft och innehållna medel (standard 10 %). Appen räknar fram varje lyft, innehållet och beloppet att fakturera, plus hållna medel som frisläpps efter slutbesiktning.
- **Mina uppgifter** (egen flik, inspirerad av Asanas Mina uppgifter). Personliga att-göra-uppgifter som bara du ser, i sektionerna Nyligen tillagda, Göra i dag, Göra nästa vecka och Göra senare. Varje uppgift har titel, slutdatum (rött när det passerat) och valfritt projekt från tavlan; knappen vid raden öppnar projektets Visa-ruta. Flytta mellan sektioner genom att dra i greppet till vänster eller välja sektion i listan på raden. Sektioner kan fällas ihop, klara uppgifter döljs men kan visas med "Visa klara".
- **Kalkylerade timmar** per projekt (fält när du redigerar kortet). Under fliken Teknikerplanering visas nyckeltal för perioden som visas: planerade timmar, tillgängliga resurstimmar, lediga timmar och beläggningsgrad, totalt och per tekniker. En bokad dag räknas som 8 timmar (delas lika om tekniken står på flera poster samma dag). Helgdagar och frånvaro minskar tillgängliga timmar. Under det en tabell per projekt med kalkylerat, planerat totalt, kvar att planera och hur stor del av kalkylen som är planerad (rött när mer är planerat än kalkylerat).
- **ÄTA** per projekt (knapp i Visa-rutan, bredvid Betalplan). Förteckning över poster av typen ÄTA, Avvikelse eller Fråga/Svar, med blankett per post efter mallen (löpnummer sätts automatiskt, Till fylls i från kunden). Fält: datum, till, avser/del, svar senast, beskrivning, kostnadsregleras ja/nej, riktning (tillkommande eller avgående), bedömd kostnad, åtgärd/svar, accepterat belopp, beslutsdatum och namn. Status: Utkast, Skickad, Besvarad, Godkänd, Avslagen, Utförd, Fakturerad. Alla belopp är exklusive moms och avgående poster räknas som minus. Kortet visar "ÄTA: n öppna" och blir rött när en skickad post passerat "svar senast". Blankett och förteckning skrivs ut som PDF (A4 stående) via skrivardialogen. I Betalplan kan du kryssa i "Räkna med godkända ÄTA", då justeras kontraktssumman och alla lyft med summan av godkända ÄTA (utförda och fakturerade räknas också). Poster kan tas bort med en bekräftelse. Löpnumret återanvänds inte, så en borttagen post lämnar ett hål i numreringen.
- **Teknikerplanering** (egen flik): rutnät med tekniker och dagar, där du väljer ett projekt och klickar eller drar över rutorna för att boka. Projekten hämtas från tavlan, och semester, sjuk och liknande läggs som egna rader. Raden Lediga visar hur många tekniker som är obokade per dag.
- **Taggfilter** ovanför tavlan: välj en eller flera taggar (till exempel Brandlarm) för att bara se de korten, även i tidsplanen och datumlistan.
- **Tidsplan** (Gantt) som bygger på datumen på korten.
- **Dokumentation som ska lämnas** med kryssrutor, egna rader och borttagning.
- **Datum att bevaka** som hämtas automatiskt från korten.
- **Ändringslogg** med vem som ändrade vad och när.
- **Roller:** administratör (allt, inklusive import), redigerare och läsare.

## Sätta upp (första gången)

### 1. Supabase

1. Skapa ett projekt på [supabase.com](https://supabase.com), region **EU (Stockholm)**. Spara databaslösenordet själv.
2. Öppna **SQL Editor**, ny fråga, klistra in hela `supabase/schema.sql` och kör. Den går att köra om utan att data försvinner.
3. Stäng för nya registreringar: **Authentication → Sign In / Providers** (eller liknande, menyerna byter namn ibland) och stäng av "Allow new users to sign up". Även om någon ändå skulle skapa ett konto kommer de inte åt något, eftersom allt kräver en rad i tabellen `members`.
4. Skapa ditt konto: **Authentication → Users → Add user → Create new user**, med e-post och lösenord, och bocka i auto-bekräfta.
5. Gör kontot till administratör. Kör i SQL Editor, byt ut e-postadressen:

   ```sql
   insert into public.members (user_id, email, role)
   select id, email, 'admin' from auth.users where email = 'din@epost.se';
   ```

6. Hämta två värden under **Project Settings → API**: projektets **URL** och den **publika nyckeln** (anon eller publishable). Använd aldrig service_role eller en nyckel som börjar på `sb_secret_`. Bygget stoppar om du råkar klistra in en sådan.

### 2. Vercel

1. På vercel.com: **Add New → Project** och importera det här arkivet.
2. Under **Environment Variables**, lägg in:
   - `SUPABASE_URL` = projektets URL
   - `SUPABASE_ANON_KEY` = den publika nyckeln
3. Klicka **Deploy**. Bygginställningarna kommer från `vercel.json`.
4. Egen adress: **Settings → Domains**.

Den publika nyckeln syns i webbläsaren. Det är meningen, och det är databasens behörighetsregler (Row Level Security i `schema.sql`) som skyddar datan.

### 3. Läs in startdata

Logga in, klicka **Import och export**, välj tavlafilen och klicka **Läs in** två gånger (andra klicket bekräftar). Filen ska ha formatet `version: 2` (samma som **Spara som fil** ger). Riktig projektdata ska inte checkas in i det här arkivet. Filnamn som `projekttavla-*.json` och `seed*.json` ignoreras av git.

### Uppdatering: tidplan och betalplan

Har du satt upp databasen före den här funktionen: öppna SQL Editor i Supabase och kör hela filen `supabase/migrations/2026-11-05-tid-betalplan.sql` en gång. Appen fungerar som vanligt utan den, men tid- och betalplan går inte att spara förrän den körts.

För ÄTA: kör `supabase/migrations/2026-11-05-ata.sql` på samma sätt. Appen fungerar utan den, men ÄTA går inte att spara förrän den körts.

För kalkylerade timmar: kör `supabase/migrations/2026-11-05-kalkylerade-timmar.sql` på samma sätt.

För Mina uppgifter: kör `supabase/migrations/2026-11-05-mina-uppgifter.sql` på samma sätt. Varje användare ser bara sina egna uppgifter, det är databasen som säkerställer det.

För teknikerplaneringen: kör `supabase/migrations/2026-11-05-teknikerplanering.sql` på samma sätt. Den skapar tabellerna och lägger in teknikerna från den gamla Excelfilen.

## Lägga till fler användare

1. **Authentication → Users → Add user** i Supabase, med e-post och lösenord.
2. Ge dem en roll i SQL Editor:

   ```sql
   insert into public.members (user_id, email, role)
   select id, email, 'editor'   -- eller 'viewer' eller 'admin'
   from auth.users where email = 'kollega@epost.se';
   ```

Byta roll: `update public.members set role = 'viewer' where email = '…';`. Ta bort åtkomst: `delete from public.members where email = '…';`. Nytt lösenord: ändra användaren under Authentication → Users.

## Köra lokalt

- Demoläge utan databas: `cd src && python3 -m http.server 8000`, öppna `http://localhost:8000/?demo`. Då används exempeldata i minnet.
- Med databas: sätt `SUPABASE_URL` och `SUPABASE_ANON_KEY`, kör `npm run build` och servera mappen `public/`.

## Så här fungerar det

| Fil | Innehåll |
|---|---|
| `src/index.html`, `src/style.css`, `src/app.js` | Hela appen |
| `src/vendor/supabase.js` | Supabase-klienten (fastlåst version, MIT) |
| `supabase/schema.sql` | Tabeller, behörighetsregler, ändringslogg och realtid |
| `build.js` | Skriver `config.js` från miljövariablerna och kontrollerar nyckeln |
| `vercel.json` | Bygginställningar och säkerhetsrubriker |

- Ändringar av ett kort kontrolleras mot ett versionsnummer. Har någon annan hunnit ändra kortet sparas inget, du får ett meddelande och formuläret ligger kvar.
- Borttagna kort och rader markeras bara som borttagna och kan återställas. Endast administratörer kan radera på riktigt i databasen.
- Gratisnivån hos Supabase pausar projekt som inte används på en vecka. Ta en export då och då som egen säkerhetskopia.
