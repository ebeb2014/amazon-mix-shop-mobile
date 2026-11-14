import unittest
from types import SimpleNamespace
from p21_live_orders import install_p21, order_id, validate_order, cart_from_order

ORDER={'id':'order-1','status':'reserved','goods_total':300,'items':[{'id':'1','code':'A','name':'One','price':100,'vat_rate':19},{'id':'2','code':'B','name':'Two','price':200,'vat_rate':19}]}
def snapshot():return {'receipt_code':'COS-TEST','items':cart_from_order(ORDER),'discounted_prices':[100,200],'total':300}

class Tests(unittest.TestCase):
 def setUp(self):
  self.calls=[];self.online=True;self.answer={'status':'saved'}
  def rpc(name,p):
   self.calls.append((name,p));return ORDER if p['p_action']=='get' else self.answer
  cloud=SimpleNamespace(get_cloud_client=lambda:SimpleNamespace(rpc=rpc),cloud_sales_ready=lambda:self.online,reserve_sale=lambda x:'normal-reserve',release_sale_reservation=lambda *x:'normal-release')
  self.errors=[]
  class App:
   cloud_data_active=True
   app_user_v248={'user_id':'u','username':'operator'}
   def save_completed_fiscal_sale(self,*x):return 'normal-save'
   def validate_fiscal_snapshot_stock(self,*x):return 'normal-validate'
   def start_real_fiscal_sale(self,*x):return 'original-start'
   def show_sales(self):pass
   def mark_fiscal_attempt_saved(self,*x):self.marked=True
  install_p21(App,{'online_database':cloud,'ctk':None,'ttk':None,'messagebox':SimpleNamespace(showerror=lambda *a:self.errors.append(a))})
  self.app=App();self.cloud=cloud
 def test_normal_sales_unchanged(self):
  s={'items':[{'product_code':'A'}]}
  self.assertIsNone(order_id(s));self.assertEqual(self.cloud.reserve_sale(s),'normal-reserve');self.assertEqual(self.app.save_completed_fiscal_sale(s,{}),'normal-save')
 def test_mixed_order_rejected(self):
  s=snapshot();s['items'].append({'product_code':'X'})
  with self.assertRaises(ValueError):order_id(s)
 def test_price_or_missing_item_rejected(self):
  for price in (99,101):
   s=snapshot();s['discounted_prices'][0]=price
   with self.assertRaises(ValueError):validate_order(s,ORDER)
  s=snapshot();s['items'].pop()
  with self.assertRaises(ValueError):validate_order(s,ORDER)
 def test_duplicate_unit_rejected(self):
  s=snapshot();s['items'][1]=s['items'][0]
  with self.assertRaises(ValueError):validate_order(s,ORDER)
 def test_precheck_does_not_transfer_stock(self):
  self.app.validate_fiscal_snapshot_stock(snapshot());self.assertEqual(self.calls[-1][1]['p_action'],'get')
 def test_transfer_uses_atomic_rpc(self):
  self.cloud.reserve_sale(snapshot());self.assertEqual(self.calls[-1][1]['p_action'],'checkout_prepare')
 def test_missing_fiscal_ok_does_not_commit(self):
  with self.assertRaises(ValueError):self.app.save_completed_fiscal_sale(snapshot(),{'status':'error'})
  self.assertEqual(self.calls,[])
 def test_unknown_commit_keeps_attempt_unsaved(self):
  self.answer={'status':'unknown'}
  with self.assertRaises(RuntimeError):self.app.save_completed_fiscal_sale(snapshot(),{'status':'ok'})
  self.assertFalse(getattr(self.app,'marked',False))
 def test_saved_and_idempotent_mark_local_attempt(self):
  for status in ('saved','already_saved'):
   self.answer={'status':status};self.app.save_completed_fiscal_sale(snapshot(),{'status':'ok','fiscal_number':'1'})
   self.assertTrue(self.app.marked)
 def test_offline_fiscal_start_blocked(self):
  self.online=False;self.assertIsNone(self.app.start_real_fiscal_sale(snapshot(),'CMD',{}));self.assertTrue(self.errors)
 def test_failed_fiscal_release_restores_live_reservation(self):
  self.answer={'handled':True};self.assertTrue(self.cloud.release_sale_reservation('COS-TEST','BONOK0'));self.assertEqual(self.calls[-1][1]['p_action'],'checkout_release')

if __name__=='__main__':unittest.main()
