// The shop's catalog. Prices are in EUR.
export const products = [
  { id: 'red-shirt-basic', name: 'Basic Red Shirt', category: 'shirts', color: 'red', price: 19.99, sizes: ['S', 'M', 'L', 'XL'] },
  { id: 'red-linen-shirt', name: 'Red Linen Shirt', category: 'shirts', color: 'red', price: 34.99, sizes: ['M', 'L'] },
  { id: 'blue-oxford-shirt', name: 'Blue Oxford Shirt', category: 'shirts', color: 'blue', price: 39.99, sizes: ['S', 'M', 'L', 'XL'] },
  { id: 'white-tee', name: 'White Tee', category: 'shirts', color: 'white', price: 14.99, sizes: ['S', 'M', 'L', 'XL'] },
  { id: 'blue-sneakers', name: 'Blue Sneakers', category: 'shoes', color: 'blue', price: 69.99, sizes: ['40', '41', '42', '43', '44'] },
  { id: 'white-sneakers', name: 'White Sneakers', category: 'shoes', color: 'white', price: 74.99, sizes: ['39', '40', '41', '42', '43'] },
  { id: 'black-boots', name: 'Black Boots', category: 'shoes', color: 'black', price: 119.99, sizes: ['41', '42', '43', '44', '45'] },
  { id: 'black-hat', name: 'Black Hat', category: 'hats', color: 'black', price: 24.99, sizes: ['one size'] },
  { id: 'red-cap', name: 'Red Cap', category: 'hats', color: 'red', price: 17.99, sizes: ['one size'] },
  { id: 'blue-beanie', name: 'Blue Beanie', category: 'hats', color: 'blue', price: 12.99, sizes: ['one size'] },
  { id: 'grey-hoodie', name: 'Grey Hoodie', category: 'sweaters', color: 'grey', price: 49.99, sizes: ['S', 'M', 'L', 'XL'] },
  { id: 'green-sweater', name: 'Green Sweater', category: 'sweaters', color: 'green', price: 59.99, sizes: ['M', 'L', 'XL'] },
];

export function findProduct(id) {
  return products.find((product) => product.id === id);
}
