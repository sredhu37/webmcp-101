// Small helpers shared by the pages: prices, the cart badge, product pictures.
import { getCart } from './shop.js';

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function formatPrice(price) {
  return `€${price.toFixed(2)}`;
}

export async function updateCartCount() {
  const { items } = await getCart();
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  document.querySelector('#cart-count').textContent = count;
}

const colors = {
  red: '#d64545', blue: '#3b6fd6', white: '#f4f4f2', black: '#2b2b2b', grey: '#9a9aa0', green: '#3f8f5f',
};

const shapes = {
  shirts: 'M70 40l30-12h20l30 12 22 26-22 14-10-10v90H78V70l-10 10-22-14z',
  shoes: 'M40 120c0-20 12-34 26-40l26 10c14 6 34 4 50 10 22 8 26 24 26 34v6H40z',
  hats: 'M60 120c0-34 18-60 50-60s50 26 50 60zm-24 0h148v14H36z',
  sweaters: 'M68 42l26-10h32l26 10 26 34-20 12-12-14v94H74V74L62 88 42 76z',
};

export function productImage(product) {
  return `<svg viewBox="0 0 220 200" role="img" aria-label="${product.name}">
    <path d="${shapes[product.category]}" fill="${colors[product.color]}" stroke="#00000022" stroke-width="2"/>
  </svg>`;
}
