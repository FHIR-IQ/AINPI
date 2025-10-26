/**
 * NUCC Healthcare Provider Taxonomy Lookup
 * Autocomplete name <-> code mapping
 */

export interface NUCCTaxonomyEntry {
  code: string;
  grouping: string;
  classification: string;
  specialization?: string;
  definition?: string;
  notes?: string;
}

/**
 * Sample NUCC Taxonomy Codes (subset for demonstration)
 * Full taxonomy available at: https://www.nucc.org/
 */
export const NUCC_TAXONOMY_DATA: NUCCTaxonomyEntry[] = [
  // Physician - Allopathic & Osteopathic
  {
    code: '207K00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Allergy & Immunology',
    definition: 'An allergist-immunologist is trained in evaluation, physical and laboratory diagnosis and management of disorders involving the immune system.'
  },
  {
    code: '207KA0200X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Allergy & Immunology',
    specialization: 'Allergy',
    definition: 'Subspecialty of allergy and immunology'
  },
  {
    code: '207L00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Anesthesiology',
    definition: 'An anesthesiologist is trained to provide pain relief and maintenance, or restoration, of a stable condition during and immediately following an operation.'
  },
  {
    code: '207LA0401X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Anesthesiology',
    specialization: 'Addiction Medicine',
    definition: 'Subspecialty focused on addiction medicine within anesthesiology'
  },
  {
    code: '207Q00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Family Medicine',
    definition: 'A family medicine physician is trained to provide continuing and comprehensive health care for the individual and family.'
  },
  {
    code: '207QA0505X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Family Medicine',
    specialization: 'Adult Medicine',
    definition: 'Focuses on adult medicine within family practice'
  },
  {
    code: '207R00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Internal Medicine',
    definition: 'An internist is trained in the diagnosis and treatment of diseases of adults.'
  },
  {
    code: '207RC0000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Internal Medicine',
    specialization: 'Cardiovascular Disease',
    definition: 'Subspecialty of internal medicine focused on cardiovascular disease'
  },
  {
    code: '207RE0101X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Internal Medicine',
    specialization: 'Endocrinology, Diabetes & Metabolism',
    definition: 'Subspecialty focused on endocrine disorders'
  },
  {
    code: '207RG0100X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Internal Medicine',
    specialization: 'Gastroenterology',
    definition: 'Subspecialty focused on digestive diseases'
  },
  {
    code: '207RI0200X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Internal Medicine',
    specialization: 'Infectious Disease',
    definition: 'Subspecialty focused on infectious diseases'
  },
  {
    code: '207RN0300X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Internal Medicine',
    specialization: 'Nephrology',
    definition: 'Subspecialty focused on kidney disease'
  },
  {
    code: '207RP1001X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Internal Medicine',
    specialization: 'Pulmonary Disease',
    definition: 'Subspecialty focused on pulmonary diseases'
  },
  {
    code: '208D00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'General Practice',
    definition: 'A general practice physician provides continuing and comprehensive health care for the individual and family.'
  },
  {
    code: '208G00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Thoracic Surgery (Cardiothoracic Vascular Surgery)',
    definition: 'A thoracic surgeon provides operative, perioperative care and critical care of patients with acquired and congenital cardiac and thoracic disease.'
  },
  {
    code: '2080P0216X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Pediatrics',
    specialization: 'Pediatric Critical Care Medicine',
    definition: 'Subspecialty focused on critically ill or injured pediatric patients'
  },
  {
    code: '208000000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Pediatrics',
    definition: 'A pediatrician is trained in the care of infants, children, and adolescents.'
  },
  {
    code: '2080A0000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Pediatrics',
    specialization: 'Adolescent Medicine',
    definition: 'Subspecialty focused on adolescent health'
  },
  {
    code: '207V00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Obstetrics & Gynecology',
    definition: 'An obstetrician/gynecologist possesses special knowledge, skills and professional capability in the medical and surgical care of the female reproductive system.'
  },
  {
    code: '207VG0400X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Obstetrics & Gynecology',
    specialization: 'Gynecology',
    definition: 'Subspecialty focused on gynecology'
  },
  {
    code: '207W00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Ophthalmology',
    definition: 'An ophthalmologist has the knowledge and professional skills needed to provide comprehensive eye and vision care.'
  },
  {
    code: '207X00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Orthopaedic Surgery',
    definition: 'An orthopaedic surgeon is trained in the preservation, investigation and restoration of the form and function of the extremities, spine and associated structures.'
  },
  {
    code: '207Y00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Otolaryngology',
    definition: 'An otolaryngologist is trained in the medical and surgical management and treatment of patients with diseases and disorders of the ear, nose, throat.'
  },
  {
    code: '2080H0002X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Pediatrics',
    specialization: 'Hospice and Palliative Medicine',
    definition: 'Subspecialty focused on hospice and palliative care for pediatric patients'
  },
  {
    code: '207ZP0105X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Pathology',
    specialization: 'Anatomic Pathology & Clinical Pathology',
    definition: 'Subspecialty covering both anatomic and clinical pathology'
  },
  {
    code: '207N00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Dermatology',
    definition: 'A dermatologist is trained to diagnose and treat pediatric and adult patients with disorders of the skin, hair, nails, and adjacent mucous membranes.'
  },
  {
    code: '2084P0800X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Psychiatry & Neurology',
    specialization: 'Psychiatry',
    definition: 'A psychiatrist is a physician specializing in the prevention, diagnosis, and treatment of mental illnesses.'
  },
  {
    code: '2084N0400X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Psychiatry & Neurology',
    specialization: 'Neurology',
    definition: 'A neurologist specializes in the diagnosis and treatment of diseases of the brain, spinal cord, peripheral nerves, and muscles.'
  },
  {
    code: '207T00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Neurological Surgery',
    definition: 'A neurological surgeon provides care for adult and pediatric patients in the treatment of pain or pathological processes in the nervous system.'
  },
  {
    code: '207U00000X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Nuclear Medicine',
    definition: 'A nuclear medicine specialist employs the properties of radioactive atoms and molecules to diagnose and treat disease.'
  },
  {
    code: '207RA0201X',
    grouping: 'Allopathic & Osteopathic Physicians',
    classification: 'Internal Medicine',
    specialization: 'Allergy & Immunology',
    definition: 'Subspecialty focused on allergy and immunology within internal medicine'
  },

  // Nurse Practitioners
  {
    code: '363L00000X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Nurse Practitioner',
    definition: 'A nurse practitioner is a registered nurse who has acquired advanced education and clinical training.'
  },
  {
    code: '363LA2100X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Nurse Practitioner',
    specialization: 'Acute Care',
    definition: 'Specializes in acute care settings'
  },
  {
    code: '363LA2200X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Nurse Practitioner',
    specialization: 'Adult Health',
    definition: 'Specializes in adult health care'
  },
  {
    code: '363LC1500X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Nurse Practitioner',
    specialization: 'Community Health',
    definition: 'Specializes in community health'
  },
  {
    code: '363LF0000X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Nurse Practitioner',
    specialization: 'Family',
    definition: 'Provides continuing comprehensive health care for individuals and families'
  },
  {
    code: '363LG0600X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Nurse Practitioner',
    specialization: 'Gerontology',
    definition: 'Specializes in care of older adults'
  },
  {
    code: '363LP0200X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Nurse Practitioner',
    specialization: 'Pediatrics',
    definition: 'Specializes in pediatric care'
  },
  {
    code: '363LP2300X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Nurse Practitioner',
    specialization: 'Primary Care',
    definition: 'Provides primary care services'
  },
  {
    code: '363LS0200X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Nurse Practitioner',
    specialization: 'School',
    definition: 'Provides health care services in school settings'
  },
  {
    code: '363LW0102X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Nurse Practitioner',
    specialization: 'Women\'s Health',
    definition: 'Specializes in women\'s health care'
  },

  // Physician Assistants
  {
    code: '363A00000X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Physician Assistant',
    definition: 'A physician assistant is a person qualified by academic and clinical training to provide patient services under the supervision of a physician.'
  },
  {
    code: '363AM0700X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Physician Assistant',
    specialization: 'Medical',
    definition: 'Provides medical services under physician supervision'
  },
  {
    code: '363AS0400X',
    grouping: 'Physician Assistants & Advanced Practice Nursing Providers',
    classification: 'Physician Assistant',
    specialization: 'Surgical',
    definition: 'Assists in surgical procedures and perioperative care'
  }
];

export class NUCCTaxonomyLookup {
  private data: NUCCTaxonomyEntry[];
  private codeIndex: Map<string, NUCCTaxonomyEntry>;
  private searchIndex: Map<string, NUCCTaxonomyEntry[]>;

  constructor(data: NUCCTaxonomyEntry[] = NUCC_TAXONOMY_DATA) {
    this.data = data;
    this.codeIndex = new Map();
    this.searchIndex = new Map();
    this.buildIndexes();
  }

  /**
   * Build search indexes for fast lookup
   */
  private buildIndexes(): void {
    // Build code index
    for (const entry of this.data) {
      this.codeIndex.set(entry.code, entry);
    }

    // Build search index (words -> entries)
    for (const entry of this.data) {
      const searchText = this.getSearchText(entry).toLowerCase();
      const words = searchText.split(/\s+/);

      for (const word of words) {
        if (word.length < 3) continue; // Skip short words

        if (!this.searchIndex.has(word)) {
          this.searchIndex.set(word, []);
        }
        this.searchIndex.get(word)!.push(entry);
      }
    }
  }

  /**
   * Get searchable text from entry
   */
  private getSearchText(entry: NUCCTaxonomyEntry): string {
    const parts = [
      entry.grouping,
      entry.classification,
      entry.specialization || '',
      entry.code
    ];
    return parts.join(' ');
  }

  /**
   * Get taxonomy entry by code
   */
  getByCode(code: string): NUCCTaxonomyEntry | undefined {
    return this.codeIndex.get(code);
  }

  /**
   * Search taxonomy by name (autocomplete)
   */
  search(query: string, limit: number = 10): NUCCTaxonomyEntry[] {
    if (!query || query.length < 2) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    const results = new Set<NUCCTaxonomyEntry>();

    // Exact code match
    const exactMatch = this.codeIndex.get(query.toUpperCase());
    if (exactMatch) {
      return [exactMatch];
    }

    // Search in all entries
    for (const entry of this.data) {
      const searchText = this.getSearchText(entry).toLowerCase();

      // Check if any of the fields contain the query
      if (
        entry.classification.toLowerCase().includes(lowerQuery) ||
        entry.specialization?.toLowerCase().includes(lowerQuery) ||
        entry.grouping.toLowerCase().includes(lowerQuery) ||
        entry.code.toLowerCase().includes(lowerQuery)
      ) {
        results.add(entry);
      }

      if (results.size >= limit) {
        break;
      }
    }

    return Array.from(results).slice(0, limit);
  }

  /**
   * Get display name for code
   */
  getDisplayName(code: string): string {
    const entry = this.getByCode(code);
    if (!entry) return code;

    const parts = [entry.classification];
    if (entry.specialization) {
      parts.push(entry.specialization);
    }
    return parts.join(' - ');
  }

  /**
   * Get all entries in a grouping
   */
  getByGrouping(grouping: string): NUCCTaxonomyEntry[] {
    return this.data.filter(entry =>
      entry.grouping.toLowerCase().includes(grouping.toLowerCase())
    );
  }

  /**
   * Get all entries for a classification
   */
  getByClassification(classification: string): NUCCTaxonomyEntry[] {
    return this.data.filter(entry =>
      entry.classification.toLowerCase().includes(classification.toLowerCase())
    );
  }

  /**
   * Autocomplete suggestions
   */
  autocomplete(query: string, limit: number = 5): Array<{ code: string; name: string; }> {
    const results = this.search(query, limit);
    return results.map(entry => ({
      code: entry.code,
      name: this.getDisplayName(entry.code)
    }));
  }

  /**
   * Get all data
   */
  getAll(): NUCCTaxonomyEntry[] {
    return this.data;
  }
}

// Export singleton instance
export const taxonomyLookup = new NUCCTaxonomyLookup();

export default taxonomyLookup;
