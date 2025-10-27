// NUCC Healthcare Provider Taxonomy (subset)
export interface NUCCTaxonomy {
  code: string;
  display: string;
  classification: string;
  specialization?: string;
}

export const NUCC_TAXONOMY: NUCCTaxonomy[] = [
  { code: '207R00000X', display: 'Internal Medicine', classification: 'Internal Medicine' },
  { code: '207RC0000X', display: 'Cardiovascular Disease', classification: 'Internal Medicine', specialization: 'Cardiovascular Disease' },
  { code: '207RE0101X', display: 'Endocrinology', classification: 'Internal Medicine', specialization: 'Endocrinology, Diabetes & Metabolism' },
  { code: '207RG0100X', display: 'Gastroenterology', classification: 'Internal Medicine', specialization: 'Gastroenterology' },
  { code: '207Q00000X', display: 'Family Medicine', classification: 'Family Medicine' },
  { code: '208000000X', display: 'Pediatrics', classification: 'Pediatrics' },
  { code: '2080P0216X', display: 'Pediatric Critical Care', classification: 'Pediatrics', specialization: 'Pediatric Critical Care Medicine' },
  { code: '207V00000X', display: 'Obstetrics & Gynecology', classification: 'Obstetrics & Gynecology' },
  { code: '207W00000X', display: 'Ophthalmology', classification: 'Ophthalmology' },
  { code: '207X00000X', display: 'Orthopaedic Surgery', classification: 'Orthopaedic Surgery' },
  { code: '207Y00000X', display: 'Otolaryngology', classification: 'Otolaryngology' },
  { code: '207N00000X', display: 'Dermatology', classification: 'Dermatology' },
  { code: '2084P0800X', display: 'Psychiatry', classification: 'Psychiatry & Neurology', specialization: 'Psychiatry' },
  { code: '2084N0400X', display: 'Neurology', classification: 'Psychiatry & Neurology', specialization: 'Neurology' },
  { code: '363L00000X', display: 'Nurse Practitioner', classification: 'Nurse Practitioner' },
  { code: '363LF0000X', display: 'Family Nurse Practitioner', classification: 'Nurse Practitioner', specialization: 'Family' },
  { code: '363LP0200X', display: 'Pediatric Nurse Practitioner', classification: 'Nurse Practitioner', specialization: 'Pediatrics' },
  { code: '363A00000X', display: 'Physician Assistant', classification: 'Physician Assistant' },
];

export function searchTaxonomy(query: string): NUCCTaxonomy[] {
  if (!query || query.length < 2) return [];

  const lowerQuery = query.toLowerCase();
  return NUCC_TAXONOMY.filter(item =>
    item.display.toLowerCase().includes(lowerQuery) ||
    item.classification.toLowerCase().includes(lowerQuery) ||
    item.code.toLowerCase().includes(lowerQuery)
  ).slice(0, 10);
}
