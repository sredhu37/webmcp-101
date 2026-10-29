import type { Product } from './types';

const colors: Record<string, string> = {
  red: '#d64545',
  blue: '#3b6fd6',
  white: '#f4f4f2',
  black: '#2b2b2b',
  grey: '#9a9aa0',
  green: '#3f8f5f',
};

const shapes: Record<Product['category'], string> = {
  shirts: 'M70 40l30-12h20l30 12 22 26-22 14-10-10v90H78V70l-10 10-22-14z',
  shoes: 'M40 120c0-20 12-34 26-40l26 10c14 6 34 4 50 10 22 8 26 24 26 34v6H40z',
  hats: 'M60 120c0-34 18-60 50-60s50 26 50 60zm-24 0h148v14H36z',
  sweaters: 'M68 42l26-10h32l26 10 26 34-20 12-12-14v94H74V74L62 88 42 76z',
};

export function ProductImage({ product }: { product: Product }) {
  return (
    <svg viewBox="0 0 220 200" role="img" aria-label={product.name}>
      <path
        d={shapes[product.category]}
        fill={colors[product.color]}
        stroke="#00000022"
        strokeWidth="2"
      />
    </svg>
  );
}
