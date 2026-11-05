# Projekttavla

Tavla, tidsplan och dokumentationslista för FST-projekt. Alla som är inloggade ser samma data. Appen är en vanlig webbplats utan ramverk, med Supabase för databas och inloggning och Vercel för hosting.

- **Tavla** med sju kolumner (Väntar, Planera in, Redo att utföra, Pågår, Rest och dokumentation, Klar, Akut), dra och släpp, ansvarig tekniker, start och slutbesiktning.
- **Visa**-knapp på varje kort som öppnar kortet i en ruta med alla uppgifter. Läsare kan också öppna rutan från tidsplanen.
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
