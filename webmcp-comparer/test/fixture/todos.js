// Test-only to-do page. State lives in localStorage, so every browser context starts fresh.
const storageKey = 'todos';
const seed = [
  { id: 1, title: 'Water the plants', priority: 'normal', done: false },
  { id: 2, title: 'Pay the electricity bill', priority: 'high', done: false },
  { id: 3, title: 'Book a dentist appointment', priority: 'low', done: true },
];

function list() {
  const stored = localStorage.getItem(storageKey);
  return stored ? JSON.parse(stored) : structuredClone(seed);
}

function save(todos) {
  localStorage.setItem(storageKey, JSON.stringify(todos));
}

function addTodo(title, priority = 'normal') {
  const todos = list();
  if (todos.some((todo) => todo.title === title)) {
    throw new Error(`A to-do called "${title}" already exists.`);
  }
  const todo = { id: Math.max(0, ...todos.map((t) => t.id)) + 1, title, priority, done: false };
  save([...todos, todo]);
  return todo;
}

function markDone(id) {
  save(list().map((todo) => (todo.id === id ? { ...todo, done: true } : todo)));
}

function escape(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span.innerHTML;
}

const main = document.getElementById('app');
const status = document.getElementById('status');

function renderHome() {
  document.title = 'To-dos | To-do fixture';
  const items = list().map((todo) =>
    todo.done
      ? `<li>${escape(todo.title)} (done)</li>`
      : `<li>${escape(todo.title)} <button data-id="${todo.id}">Mark done</button></li>`,
  );
  main.innerHTML = `<h1>To-dos</h1>
    <ul id="todos">${items.join('')}</ul>
    <form id="add-todo">
      <label for="title">New to-do</label>
      <input id="title" name="title" required />
      <label for="priority">Priority</label>
      <select id="priority" name="priority">
        <option value="low">Low</option>
        <option value="normal" selected>Normal</option>
        <option value="high">High</option>
      </select>
      <button type="submit">Add</button>
    </form>`;
  for (const button of main.querySelectorAll('#todos button')) {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.id);
      markDone(id);
      renderHome();
      status.textContent = `Marked "${list().find((todo) => todo.id === id).title}" done.`;
    });
  }
  main.querySelector('#add-todo').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      const todo = addTodo(String(data.get('title')).trim(), String(data.get('priority')));
      renderHome();
      status.textContent = `Added "${todo.title}".`;
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

function renderDone() {
  document.title = 'Done | To-do fixture';
  const items = list().filter((todo) => todo.done);
  main.innerHTML = `<h1>Done</h1>
    <ul>${items.map((todo) => `<li>${escape(todo.title)}</li>`).join('')}</ul>`;
}

// The declarative WebMCP tool: Chromium turns this form into the create_todo tool.
function renderNew() {
  document.title = 'New to-do | To-do fixture';
  main.innerHTML = `<h1>New to-do</h1>
    <form id="new-todo" toolname="create_todo" tooldescription="Create a to-do with the given title." toolautosubmit>
      <label for="new-title">Title</label>
      <input id="new-title" name="title" required toolparamdescription="What needs doing" />
      <button type="submit">Create</button>
    </form>`;
  main.querySelector('#new-todo').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = String(new FormData(event.target).get('title')).trim();
    let todo;
    try {
      todo = addTodo(title);
    } catch (error) {
      status.textContent = error.message;
      if (event.agentInvoked) event.respondWith(Promise.resolve({ error: error.message }));
      return;
    }
    if (event.agentInvoked) {
      event.respondWith(Promise.resolve({ id: todo.id, title: todo.title }));
      setTimeout(() => location.assign('/'), 50);
    } else {
      location.assign('/');
    }
  });
}

const pages = { '/': renderHome, '/done': renderDone, '/new': renderNew };
(pages[location.pathname] ?? (() => (main.innerHTML = '<h1>Not found</h1>')))();
document.getElementById('done-link').textContent =
  `Done (${list().filter((todo) => todo.done).length})`;

/** Read-only view for Success check scripts, e.g. `todos.list().some(t => t.done)`. */
window.todos = { list };

const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

if (document.modelContext) {
  document.modelContext.registerTool({
    name: 'add_todo',
    description: 'Add a to-do. Returns the new to-do.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      },
      required: ['title'],
    },
    execute: async ({ title, priority }) => {
      try {
        return text(addTodo(title, priority));
      } catch (error) {
        return { content: [{ type: 'text', text: error.message }], isError: true };
      }
    },
  });
  document.modelContext.registerTool({
    name: 'list_todos',
    description: 'List the to-dos. Pass done to get only done or only open ones.',
    inputSchema: { type: 'object', properties: { done: { type: 'boolean' } } },
    annotations: { readOnlyHint: true },
    execute: async ({ done }) =>
      text(list().filter((todo) => done === undefined || todo.done === done)),
  });
}
