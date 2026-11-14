"""Live orders adapter. No fiscal command is emitted by this module.
Installed last; fiscal writes continue through the existing BONOK=1 workflow.
"""
from decimal import Decimal


def order_id(snapshot):
    items = (snapshot or {}).get('items') or []
    ids = {str(x.get('live_order_id') or '') for x in items}
    marked = ids - {''}
    if not marked:
        return None
    if len(marked) != 1 or '' in ids or any(x.get('item_type') == 'consumable' for x in items):
        raise ValueError('Comanda online trebuie să fie singură pe bon, fără articole adăugate.')
    return next(iter(marked))


def validate_order(snapshot, order):
    if order.get('status') not in ('reserved', 'checkout'):
        raise ValueError('Comanda nu mai este rezervată. Actualizează lista de comenzi online.')
    expected = {str(x['code']): Decimal(str(x['price'])) for x in order['items']}
    items, prices = snapshot.get('items', []), snapshot.get('discounted_prices', [])
    if len(items) != len(expected) or len(prices) != len(items):
        raise ValueError('Produsele din bon diferă de comandă. Golește bonul și preia comanda din nou.')
    if len({x['product_code'] for x in items}) != len(items):
        raise ValueError('Produs duplicat în bon.')
    for item, price in zip(items, prices):
        if expected.get(item['product_code']) != Decimal(str(price)):
            raise ValueError('Prețurile din bon diferă de comandă. Reia preluarea comenzii.')
    if Decimal(str(snapshot.get('total'))) != Decimal(str(order['goods_total'])):
        raise ValueError('Totalul bonului diferă de totalul produselor.')


def cart_from_order(order):
    return [dict(product_code=x['code'], name=x['name'], sale_price=float(x['price']),
                 vat_rate=float(x['vat_rate']), group_key='LIVE:'+str(x['id']),
                 live_order_id=order['id']) for x in order['items']]


def install_p21(App, app_globals):
    cloud = app_globals['online_database']
    ctk, ttk, messagebox = (app_globals[x] for x in ('ctk', 'ttk', 'messagebox'))
    original_reserve, original_release = cloud.reserve_sale, cloud.release_sale_reservation
    original_save, original_validate = App.save_completed_fiscal_sale, App.validate_fiscal_snapshot_stock
    original_start, original_show = App.start_real_fiscal_sale, App.show_sales

    def rpc(action, data=None):
        return cloud.get_cloud_client().rpc('ams_live_api', {'p_action': action, 'p_data': data or {}})

    def reserve(snapshot):
        oid = order_id(snapshot)
        if oid:
            return rpc('checkout_prepare', {'id': oid, 'snapshot': snapshot})
        return original_reserve(snapshot)

    def release(receipt_code, reason=''):
        # A failed lookup is never treated as permission to release an unknown hold.
        result = rpc('checkout_release', {'receipt_code': receipt_code, 'reason': reason})
        if isinstance(result, dict) and result.get('handled'):
            return True
        return original_release(receipt_code, reason)

    def validate(self, snapshot):
        oid = order_id(snapshot)
        if not oid:
            return original_validate(self, snapshot)
        if not self.cloud_data_active or not cloud.cloud_sales_ready():
            raise ValueError('Comenzile online necesită conexiune la magazin înainte de emiterea bonului.')
        # The authoritative reservation transfer occurs later, atomically, before FiscalNet.
        validate_order(snapshot, rpc('get', {'id': oid}))
        queue = app_globals.get('p18_queue')
        if queue:
            for item in snapshot['items']:
                holder = queue.locked_by(item['product_code'])
                if holder and holder != snapshot['receipt_code']:
                    raise ValueError('Produsul are un bon local nesincronizat. Verifică sincronizarea.')

    def start(self, snapshot, command_text, config):
        if self.cloud_data_active and not cloud.cloud_sales_ready():
            messagebox.showerror('Conexiune necesară', 'Rezervările online cer verificarea stocului în cloud. Bonul nu a fost trimis. Restabilește conexiunea.')
            return
        return original_start(self, snapshot, command_text, config)

    def save(self, snapshot, fiscal_result):
        oid = order_id(snapshot)
        if not oid:
            return original_save(self, snapshot, fiscal_result)
        if fiscal_result.get('status') != 'ok':
            raise ValueError('FiscalNet nu a confirmat BONOK=1.')
        user = getattr(self, 'app_user_v248', None) or {}
        data = dict(snapshot)
        data['operator_user_id'] = str(user.get('user_id') or '')
        data['operator_username'] = user.get('display_name') or user.get('username') or 'utilizator'
        result = rpc('checkout_commit', {'id': oid, 'snapshot': data, 'fiscal_status': 'ok',
                     'fiscal_number': str(fiscal_result.get('fiscal_number') or ''),
                     'response_text': str(fiscal_result.get('response_text') or '')})
        if not isinstance(result, dict) or result.get('status') not in ('saved', 'already_saved'):
            raise RuntimeError('Bon emis, salvare neconfirmată. Reconciliază bonul; nu îl emite din nou.')
        self.mark_fiscal_attempt_saved(snapshot, fiscal_result)
        return result

    def open_orders(self):
        if getattr(self, 'fiscal_sale_in_progress', False):
            messagebox.showwarning('Bon în curs', 'Așteaptă răspunsul casei de marcat.')
            return
        try:
            rows = rpc('list')
        except Exception as error:
            messagebox.showerror('Comenzi online', str(error)); return
        window = ctk.CTkToplevel(self)
        window.title('Comenzi online · Amazon Mix Shop')
        window.geometry('1000x580')
        ctk.CTkLabel(window, text='Rezervările online se transferă în bon la emitere.', font=('Segoe UI', 16, 'bold')).pack(padx=16, pady=14)
        columns = ('Nr.', 'Client', 'Bucăți', 'Produse', 'Transport', 'Avans', 'Stare')
        table = ttk.Treeview(window, columns=columns, show='headings', height=16)
        for key in columns:
            table.heading(key, text=key); table.column(key, width=115, anchor='w')
        table.column('Client', width=240)
        table.pack(fill='both', expand=True, padx=16)
        status_labels = {'reserved': 'Rezervată', 'checkout': 'Bon în curs'}
        for row in rows:
            if row['status'] in status_labels:
                table.insert('', 'end', iid=row['id'], values=(row['number'], row['customer'].get('name'), len(row['items']), row['goods_total'], row['shipping'], row['advance'], status_labels[row['status']]))

        def take():
            selected = table.selection()
            if not selected:
                return
            if getattr(self, 'sales_cart', []):
                messagebox.showwarning('Bon ocupat', 'Deschide un bon gol înainte să preiei comanda online.'); return
            try:
                order = rpc('get', {'id': selected[0]})
                if order['status'] != 'reserved':
                    raise ValueError('Comanda are deja un bon în curs. Verifică bonul și răspunsul fiscal; nu o prelua din nou.')
                customer = order['customer']
                detail = ('Comanda #'+str(order['number'])+' · '+customer.get('name','')+'\n'
                          +'Produse: '+str(order['goods_total'])+' lei\n'
                          +'Transport separat: '+str(order['shipping'])+' lei; avans: '+str(order['advance'])+' lei.\n\n'
                          +'Bonul preia doar produsele. Verifică documentele avansului, transportul și metoda de încasare înainte de emitere.')
                if not messagebox.askyesno('Preluare comandă online', detail):
                    return
                self.sales_cart = cart_from_order(order)
                self.cart_discount_value = 0.0
                self.cart_customer_data = self.empty_customer_data()
                self.cart_customer_data.update(name=customer.get('name',''), phone=customer.get('phone',''), address=customer.get('address',''), city=customer.get('city',''), county=customer.get('county',''))
                notes = 'LIVE #'+str(order['number'])+'; transport '+str(order['shipping'])+'; avans '+str(order['advance'])+'; '+order.get('notes','')
                for attr, text in [('cart_client_entry', customer.get('name','')), ('cart_notes_entry', notes), ('cart_discount_entry','')]:
                    widget = getattr(self, attr, None)
                    if widget is not None:
                        widget.delete(0,'end'); widget.insert(0,text)
                self.refresh_sales_cart_table()
                window.destroy()
            except Exception as error:
                messagebox.showerror('Comanda nu a fost preluată', str(error))
        bar = ctk.CTkFrame(window, fg_color='transparent'); bar.pack(fill='x', padx=16, pady=16)
        ctk.CTkButton(bar, text='Preia în bon', command=take).pack(side='left', padx=6)
        ctk.CTkButton(bar, text='Actualizează lista', command=lambda: (window.destroy(), open_orders(self))).pack(side='left', padx=6)
        ctk.CTkButton(bar, text='Închide', command=window.destroy).pack(side='right')

    def show(self):
        result = original_show(self)
        widgets = self.main.winfo_children()
        bar = ctk.CTkFrame(self.main, fg_color='transparent')
        if widgets:
            bar.pack(fill='x', padx=18, pady=4, before=widgets[0])
        else:
            bar.pack(fill='x', padx=18, pady=4)
        ctk.CTkButton(bar, text='Comenzi online', command=lambda: open_orders(self)).pack(side='left')
        ctk.CTkLabel(bar, text='Live • stoc verificat online înainte de bon').pack(side='left', padx=14)
        return result

    cloud.reserve_sale, cloud.release_sale_reservation = reserve, release
    App.validate_fiscal_snapshot_stock, App.start_real_fiscal_sale = validate, start
    App.save_completed_fiscal_sale, App.show_sales = save, show
