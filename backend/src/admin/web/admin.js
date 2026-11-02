/*
 * The admin page (docs/design/17-admin.md). It holds no data: everything shown comes from /admin/api after
 * signing in, and the token lives in this tab's memory only. Server text is written with textContent, never as
 * HTML, so nothing a user typed can run here.
 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var token = null;
  var adminEmail = null;

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === 'text') node.textContent = props[key];
      else if (key === 'className') node.className = props[key];
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), props[key]);
      else node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) {
      if (child)
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** One request; a 401 means the session is over (expired token, disabled account). */
  function call(method, path, body) {
    var headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (response) {
      if (response.status === 204) return { status: 204, body: null };
      return response
        .json()
        .catch(function () {
          return null;
        })
        .then(function (json) {
          return { status: response.status, body: json };
        });
    });
  }

  function message(result, fallback) {
    return (result.body && result.body.error && result.body.error.message) || fallback;
  }

  function signOut(note) {
    token = null;
    adminEmail = null;
    showSignIn(note);
  }

  // --- Sign in -------------------------------------------------------------------------

  function showSignIn(note) {
    clear(app);
    var email = el('input', { type: 'email', autocomplete: 'username', required: 'required' });
    var password = el('input', {
      type: 'password',
      autocomplete: 'current-password',
      required: 'required',
    });
    var error = el('p', { className: 'error', text: note || '' });
    var submit = el('button', { className: 'primary', type: 'submit', text: 'Sign in' });
    var form = el('form', { className: 'card signin' }, [
      el('h1', { text: 'Expenses admin' }),
      el('label', {}, ['Email', email]),
      el('label', {}, ['Password', password]),
      error,
      submit,
    ]);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submit.disabled = true;
      error.textContent = '';
      call('POST', '/v1/auth/login', { email: email.value, password: password.value })
        .then(function (login) {
          if (login.status !== 200) {
            error.textContent =
              login.status === 429
                ? 'Too many attempts. Try again in a few minutes.'
                : 'Email or password is not right.';
            return null;
          }
          token = login.body.accessToken;
          return call('GET', '/admin/api/me');
        })
        .then(function (me) {
          if (me === null) return;
          if (me.status !== 200) {
            token = null;
            error.textContent = 'This account is not an admin.';
            return;
          }
          adminEmail = me.body.email;
          showDashboard();
        })
        .catch(function () {
          error.textContent =
            'Could not reach the server. It may be waking up; try again in a minute.';
        })
        .then(function () {
          submit.disabled = false;
          password.value = '';
        });
    });
    app.appendChild(form);
    email.focus();
  }

  // --- Dashboard -----------------------------------------------------------------------

  function number(value) {
    return new Intl.NumberFormat().format(value);
  }

  function bytes(value) {
    var units = ['B', 'KB', 'MB', 'GB'];
    var size = value;
    var unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return (unit === 0 ? String(size) : size.toFixed(1)) + ' ' + units[unit];
  }

  function duration(seconds) {
    if (seconds < 3600) return Math.max(1, Math.round(seconds / 60)) + ' min';
    if (seconds < 86400) return Math.round(seconds / 3600) + ' h';
    return Math.round(seconds / 86400) + ' days';
  }

  function when(iso) {
    return iso ? new Date(iso).toLocaleString() : 'never';
  }

  function stat(label, value, note) {
    return el('div', { className: 'card stat' }, [
      el('div', { className: 'value', text: value }),
      el('div', { className: 'label', text: label }),
      note ? el('div', { className: 'note', text: note }) : null,
    ]);
  }

  function renderOverview(host, data) {
    clear(host);
    var gem = data.gemini;
    var use = function (b) {
      return number(b.used) + ' of ' + number(b.limit) + ' today';
    };
    [
      stat(
        'Accounts',
        number(data.users.total),
        number(data.users.verified) + ' verified, ' + number(data.users.disabled) + ' disabled',
      ),
      stat(
        'New in 7 days',
        number(data.users.newLast7Days),
        number(data.users.newLast30Days) + ' in 30 days',
      ),
      stat(
        'Active in 7 days',
        number(data.users.activeLast7Days),
        number(data.users.activeLast30Days) + ' in 30 days',
      ),
      stat(
        'Households',
        number(data.households.total),
        number(data.households.memberships) + ' memberships',
      ),
      stat(
        'Expenses',
        number(data.data.expenses),
        number(data.data.categories) + ' categories, ' + number(data.data.goals) + ' goals',
      ),
      stat(
        'Receipt photos',
        number(data.data.receipts),
        number(data.data.recurringRules) + ' recurring rules',
      ),
      stat('Database', bytes(data.database.sizeBytes)),
      stat('Server', data.server.version, 'up ' + duration(data.server.uptimeSeconds)),
      stat('Gemini', gem.configured ? 'On' : 'Off', gem.configured ? gem.model : 'no key set'),
      stat('Receipt reading', use(gem.receipts)),
      stat('Quick add', use(gem.quickAdd)),
      stat('Monthly recap', use(gem.recap)),
    ].forEach(function (card) {
      host.appendChild(card);
    });
  }

  function showDashboard() {
    clear(app);
    var overviewHost = el('div', { className: 'grid' });
    var tableHost = el('div', { className: 'table-wrap' });
    var more = el('button', { type: 'button', text: 'Load more' });
    var status = el('p', { className: 'error' });
    var search = el('input', {
      type: 'search',
      placeholder: 'Search by email',
      'aria-label': 'Search by email',
    });
    var state = { search: '', cursor: null, rows: [] };

    function loadOverview() {
      call('GET', '/admin/api/overview').then(function (result) {
        if (result.status === 401) return signOut('Your session ended. Sign in again.');
        if (result.status !== 200) {
          status.textContent = message(result, 'Could not load the overview.');
          return;
        }
        renderOverview(overviewHost, result.body);
      });
    }

    function renderTable() {
      clear(tableHost);
      var head = el(
        'tr',
        {},
        ['Email', 'Joined', 'Last active', 'Expenses', 'Households', ''].map(function (name) {
          return el('th', { text: name });
        }),
      );
      var body = el('tbody', {}, state.rows.map(row));
      tableHost.appendChild(el('table', {}, [el('thead', {}, [head]), body]));
      more.style.display = state.cursor ? '' : 'none';
    }

    function replaceRow(user) {
      state.rows = state.rows.map(function (r) {
        return r.id === user.id ? user : r;
      });
      renderTable();
    }

    function row(user) {
      var badges = [];
      if (user.isAdmin) badges.push(el('span', { className: 'badge', text: 'admin' }));
      if (user.disabledAt) badges.push(el('span', { className: 'badge off', text: 'disabled' }));
      var actions = el('div', { className: 'actions' });
      if (!user.isAdmin) {
        actions.appendChild(
          el('button', {
            type: 'button',
            text: user.disabledAt ? 'Enable' : 'Disable',
            onclick: function () {
              call(
                'POST',
                '/admin/api/users/' + user.id + (user.disabledAt ? '/enable' : '/disable'),
                {},
              ).then(function (result) {
                if (result.status === 401) return signOut('Your session ended. Sign in again.');
                if (result.status !== 200) {
                  status.textContent = message(result, 'That did not work.');
                  return;
                }
                status.textContent = '';
                replaceRow(result.body.user);
                loadOverview();
              });
            },
          }),
        );
        actions.appendChild(
          el('button', {
            type: 'button',
            className: 'danger',
            text: 'Delete',
            onclick: function () {
              var typed = window.prompt(
                'This deletes ' +
                  user.email +
                  ' and everything they stored. It cannot be undone.\n\nType their email to confirm:',
              );
              if (typed === null) return;
              call('DELETE', '/admin/api/users/' + user.id, { email: typed }).then(
                function (result) {
                  if (result.status === 401) return signOut('Your session ended. Sign in again.');
                  if (result.status !== 204) {
                    status.textContent = message(result, 'That did not work.');
                    return;
                  }
                  status.textContent = '';
                  state.rows = state.rows.filter(function (r) {
                    return r.id !== user.id;
                  });
                  renderTable();
                  loadOverview();
                },
              );
            },
          }),
        );
      }
      return el('tr', {}, [
        el(
          'td',
          {},
          [user.email + (user.displayName ? ' (' + user.displayName + ')' : '')].concat(badges),
        ),
        el('td', { text: when(user.createdAt) }),
        el('td', { text: when(user.lastActiveAt) }),
        el('td', { text: number(user.expenseCount) }),
        el('td', { text: number(user.householdCount) }),
        el('td', {}, [actions]),
      ]);
    }

    function loadUsers(reset) {
      if (reset) {
        state.cursor = null;
        state.rows = [];
      }
      var query =
        '?limit=25' +
        (state.search ? '&search=' + encodeURIComponent(state.search) : '') +
        (state.cursor ? '&cursor=' + state.cursor : '');
      call('GET', '/admin/api/users' + query).then(function (result) {
        if (result.status === 401) return signOut('Your session ended. Sign in again.');
        if (result.status !== 200) {
          status.textContent = message(result, 'Could not load the accounts.');
          return;
        }
        state.rows = state.rows.concat(result.body.users);
        state.cursor = result.body.nextCursor;
        renderTable();
      });
    }

    var searchForm = el('form', { className: 'search' }, [
      search,
      el('button', { type: 'submit', text: 'Search' }),
    ]);
    searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      state.search = search.value.trim();
      loadUsers(true);
    });
    more.addEventListener('click', function () {
      loadUsers(false);
    });

    app.appendChild(
      el('div', { className: 'bar' }, [
        el('div', {}, [
          el('h1', { text: 'Expenses admin' }),
          el('div', { className: 'muted', text: adminEmail }),
        ]),
        el('div', { className: 'actions' }, [
          el('button', {
            type: 'button',
            text: 'Refresh',
            onclick: function () {
              loadOverview();
              loadUsers(true);
            },
          }),
          el('button', {
            type: 'button',
            text: 'Sign out',
            onclick: function () {
              signOut('');
            },
          }),
        ]),
      ]),
    );
    app.appendChild(el('h2', { text: 'Overview' }));
    app.appendChild(overviewHost);
    app.appendChild(el('h2', { text: 'Accounts' }));
    app.appendChild(searchForm);
    app.appendChild(status);
    app.appendChild(tableHost);
    app.appendChild(el('p', {}, [more]));
    loadOverview();
    loadUsers(true);
  }

  showSignIn('');
})();
