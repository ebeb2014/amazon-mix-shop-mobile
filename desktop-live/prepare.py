"""Prepare pinned V24.20 source; refuses a different source layout."""
import ast, pathlib, shutil, sys
root=pathlib.Path(sys.argv[1]); main=root/'app_P13_11_3_ATOMIC_DEV.py'
s=main.read_text(encoding='utf-8-sig')
for method in ['validate_fiscal_snapshot_stock','start_real_fiscal_sale','save_completed_fiscal_sale','show_sales']:
    if 'def '+method+'(' not in s: raise SystemExit('Incompatible desktop source: '+method)
anchor='if __name__ == "__main__":'
if s.count(anchor)!=1 or 'install_p20(App, globals())' not in s: raise SystemExit('Unexpected source version')
s=s.replace(anchor,'from p21_live_orders import install_p21\ninstall_p21(App, globals())\n\n'+anchor)
ast.parse(s);main.write_text(s,encoding='utf-8')
shutil.copy2(pathlib.Path(__file__).with_name('p21_live_orders.py'),root/'p21_live_orders.py')
# The older offline fallback cannot see concurrent mobile reservations.
# Keep recovery of previously emitted offline receipts, but require cloud before new fiscal emission.
p=root/'p18_offline_queue.py';s=p.read_text(encoding='utf-8')
a=s.index('        if not messagebox.askyesno(\n            "Lucru fără internet",')
b=s.index('\n    def reserve_snapshot_consumables_offline',a)
s=s[:a]+'''        messagebox.showerror("Conexiune necesară", "Rezervările online sunt active. Restabilește conexiunea înainte de emiterea bonului.")
        return
''' + s[b:]
# Expose existing local locks for the Live validation adapter.
s=s.replace('    stare = {"app": None,', '    app_globals["p18_queue"] = queue\n    stare = {"app": None,')
ast.parse(s);p.write_text(s,encoding='utf-8')
print('Prepared V24.21 Live source')
