export interface Pattern {
  id: string;
  title: string;
  author: string;
  primaryProductType: string;
  imageUrl: string;
  isFree: boolean;
  productTypes: string[];
  instruments: string[];
  tags: string[];
  externalLink: string;
}

export interface FetchPatternsOptions {
  search?: string;
  isFree?: boolean;
  isNew?: boolean;
  limit?: number;
  offset?: number;
}

export const fetchPatterns = async (options?: FetchPatternsOptions): Promise<Pattern[]> => {
  const url = new URL("http://localhost:3000/patterns");
  
  if (options?.search) url.searchParams.append("search", options.search);
  if (options?.isFree) url.searchParams.append("isFree", "true");
  if (options?.isNew) url.searchParams.append("isNew", "true");
  if (options?.limit !== undefined) url.searchParams.append("limit", options.limit.toString());
  if (options?.offset !== undefined) url.searchParams.append("offset", options.offset.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch patterns: ${response.status}`);
  }
  const patterns: Pattern[] = await response.json();
  return patterns.map(p => ({
    ...p,
    imageUrl: p.imageUrl.startsWith('/') ? `http://localhost:3000${p.imageUrl}` : p.imageUrl
  }));
};

export const fetchPatternById = async (id: string): Promise<Pattern> => {
  const response = await fetch(`http://localhost:3000/patterns/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch pattern ${id}: ${response.status}`);
  }
  const pattern: Pattern = await response.json();
  return {
    ...pattern,
    imageUrl: pattern.imageUrl.startsWith('/') ? `http://localhost:3000${pattern.imageUrl}` : pattern.imageUrl
  };
};
