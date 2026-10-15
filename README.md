# konta-rulebook

Regulile fiscale ale Moldovei, scrise ca date pe care un program le poate citi: cotele de impozit,
plafoanele, termenele de plată și planul de conturi după care își ține o firmă contabilitatea.
Fiecare cifră are data de la care se aplică și legea din care vine.

> **Atenție: datele de aici sunt ciorne.** Le-am luat din ce publică Ministerul Finanțelor,
> Serviciul Fiscal de Stat și Casa Națională de Asigurări Sociale, dar un contabil autorizat nu le-a
> verificat încă în textul legii. Nu le folosiți pentru declarații reale până nu le aprobă.

## De ce este public

Cine alege un program de contabilitate nou are dreptul să întrebe de unde știe că impozitele ies
corect. Aici poate citi singur fiecare regulă și sursa ei. Dacă găsiți o greșeală, scrieți-ne pe
GitHub sau propuneți direct corectura.

## Cum sunt ținute regulile

Nicio cifră nu stă aici fără trimitere la legea sau hotărârea din care vine.

Legea se schimbă și în timpul anului, iar fiecare schimbare rămâne vizibilă cu data ei. Plafonul de
la care o firmă trebuie să plătească TVA, de exemplu, s-a schimbat de două ori în 2026.

O regulă aprobată nu se mai rescrie. O corectură se adaugă alături, ca să se poată vedea oricând
după ce reguli s-a calculat o declarație depusă deja.

Planul de conturi, adică lista oficială a conturilor în care o firmă își înregistrează operațiunile,
este copiat din textul ordinului Ministerului Finanțelor nr. 119/2013, așa cum se aplică din
1 ianuarie 2020. Un program verifică apoi să nu lipsească și să nu se repete niciun cont.

## Calendarul fiscal

Tot aici sunt termenele de depunere și de plată (TVA12, IPC21, VEN12, IU17, contribuțiile CNAS și
primele CNAM, rapoartele statistice și celelalte), zilele de sărbătoare din Codul muncii și
schimbările din lege, fiecare cu actul și articolul din care vine. Un termen care cade într-o zi de
odihnă se mută doar când actul o cere, iar un program verifică datele calculate cu cele publicate de
SFS și CNAS. Din aceleași fișiere se generează calendarul de pe
[konta.md/calendar](https://konta.md/calendar/), cu abonament în calendarul telefonului și flux RSS
al schimbărilor.

## Exemple de calcul al salariului

În `vectors/payroll-md-2026.json` sunt exemple de salarii calculate lună de lună după metoda
cumulativă din HG nr. 697/2014, cu valorile din `md-2026`: primul este exemplul publicat de SFS
(brut 10.000 lei, primă 900, scutire 2.475, venit impozabil 6.625, impozit 795, net 8.305,
CNAS 2.400), apoi persoane întreținute, plafonul scutirii personale și rotunjirea la ban. Aceleași
exemple le trec două programe scrise separat: calculul salariilor din aplicația Konta și
calculatorul de pe [konta.md/calculator-salariu](https://konta.md/calculator-salariu/). Dacă unul
dintre ele diferă cu un ban, testele lui cad. Fișierul nu repetă cotele: cine îl rulează le citește
din acest registru, așa că o cotă schimbată aici face exemplele să cadă până sunt recalculate.

## Ce nu știm încă

- Dacă e-Factura va deveni obligatorie pentru toate firmele, și de când.
- Dacă plafonul de rambursare a TVA crește la 70% pentru firmele care folosesc e-Factura.
- Cifrele finale pentru 2027.

## Pentru cine vrea să contribuie

Formatul datelor și regulile pentru modificări sunt în [docs/FORMAT.md](docs/FORMAT.md).

---

Datele din `data/` și `charts/` sunt sub licența [CC BY 4.0](LICENSE): le puteți folosi liber,
inclusiv în scop comercial, dacă menționați sursa. Instrumentele și schemele sunt sub licența MIT.
© 2026 December Capital.
