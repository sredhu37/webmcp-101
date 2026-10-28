import { checkout, getCart } from './shop.js';
import { formatPrice, updateCartCount } from './ui.js';

async function showCart() {
  const { items, total } = await getCart();
  const cart = document.querySelector('#cart');
  if (items.length === 0) {
    cart.innerHTML = '<p class="muted">Your cart is empty. <a href="/">Keep shopping</a>.</p>';
    return;
  }
  cart.innerHTML = `<table>
    <thead><tr><th>Product</th><th>Size</th><th>Qty</th><th>Price</th></tr></thead>
    <tbody>
      ${items.map((item) => `<tr>
        <td>${item.name}</td><td>${item.size}</td><td>${item.quantity}</td>
        <td>${formatPrice(item.price * item.quantity)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <p class="total">Total ${formatPrice(total)}</p>`;
  document.querySelector('#checkout-section').hidden = false;
}

document.querySelector('#checkout').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const order = await checkout({
      name: form.get('name'),
      email: form.get('email'),
      address: form.get('address'),
    });
    location.assign(`/order?id=${order.id}`);
  } catch (error) {
    event.target.querySelector('.status').textContent = error.message;
  }
});

showCart();
updateCartCount();
