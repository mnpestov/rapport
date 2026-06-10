import crypto from 'crypto';

const cyrillicToLatinMap: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
  'я': 'ya'
};

const transliterate = (text: string) => {
  return text.toLowerCase().split('').map(char => cyrillicToLatinMap[char] || char).join('');
};

export const generateSlug = (title: string) => {
  let slug = transliterate(title);
  slug = slug.replace(/#/g, '').replace(/[\s_]+/g, '-').replace(/[^a-z0-9\-]/g, '');
  slug = slug.replace(/-+/g, '-').replace(/^-|-$/g, '');
  
  if (!slug) slug = crypto.randomBytes(4).toString('hex');
  return slug;
};
