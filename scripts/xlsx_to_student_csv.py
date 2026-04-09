# One-off: Excel (Bengali headers) → app import CSV. Run: python scripts/xlsx_to_student_csv.py
import csv
import os
import re

import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def bn_to_en(s):
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    s = str(s).strip()
    trans = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
    return s.translate(trans)


def first_phone(cell):
    s = bn_to_en(cell)
    for part in re.split(r"[,;]", s):
        digits = re.sub(r"\D", "", part.strip())
        if len(digits) >= 10:
            return digits[:11]
    digits = re.sub(r"\D", "", s)
    return digits[:11] if len(digits) >= 10 else digits


def main():
    xlsx_path = None
    for f in os.listdir(BASE):
        if f.endswith(".xlsx") and not f.startswith("~"):
            xlsx_path = os.path.join(BASE, f)
            break
    if not xlsx_path:
        raise SystemExit("No .xlsx in project root")

    df = pd.read_excel(xlsx_path, header=None)
    rows = []
    pin_n = 4001
    for ri in range(1, len(df)):
        row = df.iloc[ri]
        name = str(row[1]).strip() if pd.notna(row[1]) else ""
        if not name or name.lower() == "nan":
            continue
        roll = bn_to_en(row[0]).strip().zfill(3)[:12]
        dob = row[2]
        father = str(row[5]).strip() if pd.notna(row[5]) else ""
        contact = first_phone(row[6])
        occ = str(row[8]).strip() if pd.notna(row[8]) else ""
        dist = str(row[9]).strip() if pd.notna(row[9]) else ""
        upa = str(row[10]).strip() if pd.notna(row[10]) else ""
        addr = str(row[11]).strip() if pd.notna(row[11]) else ""
        note_parts = []
        if pd.notna(dob):
            note_parts.append("জন্ম: " + str(dob).split()[0])
        if addr:
            note_parts.append("ঠিকানা: " + addr.replace(",", ";"))
        note = " | ".join(note_parts)
        pin = str(pin_n)
        pin_n += 1
        cls = "ওয়াক্বফ ৩য় বর্ষ"
        rows.append(
            {
                "name": name,
                "pin": pin,
                "class": cls,
                "roll": roll,
                "father_name": father,
                "father_occupation": occ,
                "contact": contact,
                "district": dist,
                "upazila": upa,
                "enrollment_date": "",
                "note": note,
            }
        )

    out = os.path.join(BASE, "waqf_3rd_year_students_import.csv")
    fields = [
        "name",
        "pin",
        "class",
        "roll",
        "father_name",
        "father_occupation",
        "contact",
        "district",
        "upazila",
        "enrollment_date",
        "note",
    ]
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        w.writerows(rows)
    print("Wrote", out, "rows:", len(rows))


if __name__ == "__main__":
    main()
