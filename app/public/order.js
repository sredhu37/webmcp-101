import { getOrder } from './shop.js';
import { escapeHtml, formatPrice, updateCartCount } from './ui.js';

const id = new URLSearchParams(location.search).get('id');
const main = document.querySelector('#order');

try {
  const order = await getOrder(id);
  main.innerHTML = `<h1>Order placed #${order.id}</h1>
    <p>Thank you, ${escapeHtml(order.name)}. A confirmation goes to ${escapeHtml(order.email)}.</p>
    <ul>${order.items.map((item) => `<li>${item.quantity} x ${item.name} (${item.size})</li>`).join('')}</ul>
    <p class="total">Total ${formatPrice(order.total)}</p>
    <p class="muted">Shipping to ${escapeHtml(order.address)}</p>
    <p><a href="/">Keep shopping</a></p>`;
} catch (error) {
  main.innerHTML = `<h1>${escapeHtml(error.message)}</h1>`;
}

updateCartCount();
