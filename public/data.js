/** CEO hourly chart buckets (factory wall time, matches FACTORY_TZ on Cloudflare). */
const FACTORY_HOURLY_START = 9;
const FACTORY_HOURLY_END = 23;

/**
 * Official shift windows (reference for staff; charts use full 9–23 span).
 * Saturday–Thursday: 09:00–13:30, 15:00–20:00, 20:40–23:30.
 * Friday: 15:00–20:00, 20:40–23:30 (no morning shift).
 */
const FACTORY_SHIFT_SCHEDULE_TEXT =
  'Sat–Thu: 9:00–13:30, 3:00–8:00 pm, 8:40–11:30 pm. Fri: 3:00–8:00 pm, 8:40–11:30 pm.';

const WORK_TYPES = [
  'Tailor (01)',
  'Tailor (02)',
  'Hand Work',
  'Stone Work',
  'Button',
  'Embroidery',
  'Ari Work',
  'Hand Designing',
  'Invoice maker',
  'Packaging',
  'Checker',
];

const EMPLOYEES = [
  {id:'e1', emp_no:109, ac_no:1,  name:'Misbah',        code:'EMP109', barcode:'00000109', process:'Tailor (01)',   color:'#3b82f6', initials:'MI', photo:'uploads/Misbah.jpeg'},
  {id:'e2', emp_no:110, ac_no:2,  name:'Cyril',         code:'EMP110', barcode:'00000110', process:'Tailor (02)', color:'#a78bfa', initials:'CY'},
  {id:'e3', emp_no:111, ac_no:3,  name:'Irfan',         code:'EMP111', barcode:'00000111', process:'Hand Work', color:'#22c55e', initials:'IR'},
  {id:'e4', emp_no:112, ac_no:4,  name:'Mohammed',      code:'EMP112', barcode:'00000112', process:'Stone Work',   color:'#f59e0b', initials:'MO'},
  {id:'e5', emp_no:113, ac_no:5,  name:'Mojeeb',        code:'EMP113', barcode:'00000113', process:'Button', color:'#ec4899', initials:'MO'},
  {id:'e6', emp_no:114, ac_no:6,  name:'Sheron',        code:'EMP114', barcode:'00000114', process:'Embroidery', color:'#06b6d4', initials:'SH'},
  {id:'e7', emp_no:115, ac_no:7,  name:'Arif',          code:'EMP115', barcode:'00000115', process:'Ari Work',   color:'#f97316', initials:'AR'},
  {id:'e8', emp_no:116, ac_no:8,  name:'Ridowan',       code:'EMP116', barcode:'00000116', process:'Hand Designing', color:'#ef4444', initials:'RI'},
  {id:'e9', emp_no:117, ac_no:9,  name:'Amirull',       code:'EMP117', barcode:'00000117', process:'Tailor (01)', color:'#8b5cf6', initials:'AM'},
  {id:'e10',emp_no:118, ac_no:10, name:'Arman',         code:'EMP118', barcode:'00000118', process:'Tailor (02)',   color:'#10b981', initials:'AR'},
  {id:'e11',emp_no:119, ac_no:11, name:'Shahid',        code:'EMP119', barcode:'00000119', process:'Hand Work', color:'#f59e0b', initials:'SH'},
  {id:'e12',emp_no:120, ac_no:12, name:'Shabaj',        code:'EMP120', barcode:'00000120', process:'Stone Work', color:'#3b82f6', initials:'SH'},
  {id:'e13',emp_no:121, ac_no:13, name:'Alazar',        code:'EMP121', barcode:'00000121', process:'Button',   color:'#ec4899', initials:'AL'},
  {id:'e14',emp_no:122, ac_no:14, name:'Hafiz',         code:'EMP122', barcode:'00000122', process:'Embroidery', color:'#a78bfa', initials:'HA'},
  {id:'e15',emp_no:123, ac_no:15, name:'Anasari',       code:'EMP123', barcode:'00000123', process:'Ari Work', color:'#22c55e', initials:'AN'},
  {id:'e16',emp_no:124, ac_no:16, name:'Maishad',       code:'EMP124', barcode:'00000124', process:'Hand Designing',   color:'#06b6d4', initials:'MA'},
  {id:'e17',emp_no:125, ac_no:17, name:'Mouthirrahman', code:'EMP125', barcode:'00000125', process:'Invoice maker', color:'#eab308', initials:'MO'},
  {id:'e19',emp_no:128, ac_no:19, name:'Ibrahim',       code:'EMP128', barcode:'00000128', process:'Packaging', color:'#84cc16', initials:'IB'},
  {id:'e20',emp_no:129, ac_no:20, name:'Farhan',        code:'EMP129', barcode:'00000129', process:'Checker',   color:'#0ea5e9', initials:'FA'},
  {id:'e21',emp_no:130, ac_no:21, name:'Naserulla',     code:'EMP130', barcode:'00000130', process:'Tailor (01)', color:'#10b981', initials:'NA'},
  {id:'e22',emp_no:131, ac_no:22, name:'Mamush',        code:'EMP131', barcode:'00000131', process:'Button', color:'#f59e0b', initials:'MA'},
  {id:'e23',emp_no:132, ac_no:23, name:'Wasim',         code:'EMP132', barcode:'00000132', process:'Embroidery',   color:'#3b82f6', initials:'WA'},
  {id:'e24',emp_no:133, ac_no:24, name:'Anwar',         code:'EMP133', barcode:'00000133', process:'Ari Work', color:'#ec4899', initials:'AN'},
  {id:'e25',emp_no:134, ac_no:25, name:'Raees',         code:'EMP134', barcode:'00000134', process:'Hand Designing', color:'#a78bfa', initials:'RA'},
  {id:'e26',emp_no:135, ac_no:26, name:'ArmanAnasari',  code:'EMP135', barcode:'00000135', process:'Tailor (01)',   color:'#22c55e', initials:'AR'},
];

var ABAYAS = [
  {id:'a1',code:'AB-0041',barcode:'AB00000041',design:'Classic Black Bisht',     status:'waiting',  process:'Tailor (01)', icon:'&#129509;'},
  {id:'a2',code:'AB-0042',barcode:'AB00000042',design:'Embroidered Ceremonial',  status:'waiting',  process:'Tailor (02)',   icon:'&#10024;'},
  {id:'a3',code:'AB-0043',barcode:'AB00000043',design:'Casual Linen Blend',      status:'progress', process:'Hand Work', icon:'&#129525;'},
  {id:'a4',code:'AB-0044',barcode:'AB00000044',design:'Royal Velvet Edition',    status:'waiting',  process:'Stone Work', icon:'&#128081;'},
  {id:'a5',code:'AB-0045',barcode:'AB00000045',design:'Minimal White Abaya',     status:'progress', process:'Button',   icon:'&#129293;'},
  {id:'a6',code:'AB-0046',barcode:'AB00000046',design:'Sport Performance',       status:'waiting',  process:'Embroidery', icon:'&#127939;'},
  {id:'a7',code:'AB-0047',barcode:'AB00000047',design:'Heritage Embossed',       status:'waiting',  process:'Ari Work', icon:'&#127807;'},
  {id:'a8',code:'AB-0048',barcode:'AB00000048',design:'Silk Ceremonial',         status:'waiting',  process:'Hand Designing',   icon:'&#128142;'},
  {id:'a9',code:'AB-0049',barcode:'AB00000049',design:'Invoice batch',           status:'waiting',  process:'Invoice maker', icon:'&#128196;'},
  {id:'a10',code:'AB-0050',barcode:'AB00000050',design:'Packaging queue',         status:'waiting',  process:'Packaging', icon:'&#128230;'},
  {id:'a11',code:'AB-0051',barcode:'AB00000051',design:'QC inspection lot',       status:'waiting',  process:'Checker', icon:'&#9989;'},
];
