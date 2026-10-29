import { addToCart, searchProducts } from './shop.js';
import { formatPrice, productImage, updateCartCount } from './ui.js';

const grid = document.querySelector('#products');

function productCard(product) {
  return `<article class="card">
    ${productImage(product)}
    <h2>${product.name}</h2>
    <p class="price">${formatPrice(product.price)}</p>
    <p class="muted">${product.color} · ${product.category}</p>
    <form class="add" data-id="${product.id}">
      <select name="size" aria-label="Size for ${product.name}">
        ${product.sizes.map((size) => `<option>${size}</option>`).join('')}
      </select>
      <button type="submit">Add to cart</button>
    </form>
    <p class="status" role="status"></p>
  </article>`;
}

async function showProducts(filters) {
  const products = await searchProducts(filters);
  document.querySelector('#result-count').textContent = `${products.length} products, cheapest first`;
  grid.innerHTML = products.map(productCard).join('');
}

document.querySelector('#search').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  showProducts({ query: form.get('query'), maxPrice: form.get('maxPrice') });
});

grid.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const status = form.nextElementSibling;
  try {
    await addToCart(form.dataset.id, new FormData(form).get('size'));
    status.textContent = 'Added to cart';
    updateCartCount();
  } catch (error) {
    status.textContent = error.message;
  }
});

showProducts();
updateCartCount();
