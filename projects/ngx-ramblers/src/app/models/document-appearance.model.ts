export interface DocumentAppearance {
  showLetterhead: boolean;
  showLogo: boolean;
  headerImage: string | null;
  showGroupName: boolean;
  showContactEmail: boolean;
  contactEmail: string | null;
  showWebsite: boolean;
  showLegal: boolean;
  showRegulator: boolean;
  footerMarkdown: string;
}

export const DEFAULT_DOCUMENT_APPEARANCE: DocumentAppearance = {
  showLetterhead: true,
  showLogo: true,
  headerImage: null,
  showGroupName: true,
  showContactEmail: true,
  contactEmail: null,
  showWebsite: true,
  showLegal: true,
  showRegulator: true,
  footerMarkdown: ""
};

export function documentAppearance(value: Partial<DocumentAppearance> | null): DocumentAppearance {
  return {...DEFAULT_DOCUMENT_APPEARANCE, ...value};
}
