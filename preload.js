const { contextBridge, ipcRenderer } = require('electron');

const names = ['stats', 'plans', 'savePlan', 'products', 'saveProduct', 'deleteProduct', 'restock', 'restockMany','sell', 'salesToday', 'checkout', 'ticketsToday', 'cancelTicket','cancelSale','deletePlan', 'importModel', 'importProductsModel', 'importProducts','importMembers','members', 'saveMember', 'deleteMember', 'archiveMember', 'unarchiveMember', 'memberPaid','renew', 'payments', 'cancelPayment', 'settle', 'freeze', 'unfreeze', 'caisse', 'backupInfo', 'pickBackup', 'autostartInfo', 'setAutostart', 'restoreBackup', 'chooseBackupDir','checkin', 'checkinsToday', 'uncheckin', 'backup', 'extendAll', 'memberHistory', 'exportXlsx', 'exportCaisse', 'whatsapp', 'photos', 'savePhoto', 'pickPhoto', 'deletePhoto', 'archiveOld'];

contextBridge.exposeInMainWorld('api', Object.fromEntries(names.map((n) => [n, async (...args) => {
  const r = await ipcRenderer.invoke('api', n, ...args);
  if (r.error) throw new Error(r.error);
  return r.data;
}])));
