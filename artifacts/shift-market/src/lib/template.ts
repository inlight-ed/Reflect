/**
 * Builds the fill-in template (XLSX) in the browser. Column names match the importer's
 * aliases, so a filled template is recognised without manual mapping.
 */
type Locale = 'ru' | 'kk' | 'en';

const headers = {
  ru: {
    products: ['Артикул', 'Название', 'Категория', 'Код товара Kaspi', 'Себестоимость', 'Логистика за шт.', 'Прочие расходы за шт.', 'Остаток', 'Срок поставки, дней', 'Комиссия Kaspi, %'],
    orders: ['№ заказа', 'Дата', 'Артикул', 'Название товара', 'Количество', 'Сумма', 'Статус'],
    ads: ['Дата', 'Артикул', 'Канал', 'Расход'],
    sheets: ['Инструкция', 'Товары', 'Продажи', 'Реклама'],
    guide: [
      ['Как заполнить шаблон Reflect'],
      [''],
      ['Товары', 'Обязательно: Артикул. Себестоимость и Остаток нужны для маржи и прогноза окончания товара. Логистика — сколько вы платите за доставку одной штуки, прочие расходы — упаковка и другое на штуку. Срок поставки — сколько дней идёт новая партия. Комиссия Kaspi — процент вашей категории.'],
      ['Продажи', 'Заполняйте, только если не загружаете выгрузку заказов из кабинета Kaspi. Обязательно: Дата, Артикул, Количество, Сумма.'],
      ['Реклама', 'Расход на рекламу по дням. Артикул нужен, чтобы посчитать окупаемость рекламы по товару.'],
      [''],
      ['Артикул должен совпадать с артикулом в выгрузке Kaspi. Код товара Kaspi — число из ссылки на карточку: kaspi.kz/shop/p/-12345678/.'],
      ['Обновляйте лист «Товары» раз в неделю — так прогноз остатков останется точным.'],
    ],
  },
  en: {
    products: ['SKU', 'Name', 'Category', 'Kaspi code', 'Cost price', 'Logistics cost', 'Other costs', 'Stock', 'Lead time days', 'Commission %'],
    orders: ['Order number', 'Date', 'SKU', 'Product name', 'Quantity', 'Amount', 'Status'],
    ads: ['Date', 'SKU', 'Channel', 'Spend'],
    sheets: ['Guide', 'Products', 'Sales', 'Ads'],
    guide: [
      ['How to fill in the Reflect template'],
      [''],
      ['Products', 'Required: SKU. Cost price and Stock drive margin and stock-out forecasts. Logistics is what you pay to deliver one unit; other costs are packaging and the like per unit. Lead time is how many days a new batch takes. Commission is your Kaspi category rate.'],
      ['Sales', 'Fill in only if you do not upload the orders export from your Kaspi seller account. Required: Date, SKU, Quantity, Amount.'],
      ['Ads', 'Ad spend by day. Add the SKU to calculate ad payback per product.'],
      [''],
      ['The SKU must match the one in your Kaspi export. The Kaspi code is the number in the card link: kaspi.kz/shop/p/-12345678/.'],
      ['Update the Products sheet weekly to keep the stock forecast accurate.'],
    ],
  },
};

export async function downloadTemplate(locale: Locale) {
  const XLSX = await import('xlsx');
  const h = locale === 'en' ? headers.en : headers.ru;
  const today = new Date().toISOString().slice(0, 10);
  const workbook = XLSX.utils.book_new();
  const guide = XLSX.utils.aoa_to_sheet(h.guide);
  guide['!cols'] = [{ wch: 18 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, guide, h.sheets[0]);
  const products = XLSX.utils.aoa_to_sheet([h.products, ['KS-1001', locale === 'en' ? 'Moisturising cream 50 ml' : 'Крем увлажняющий 50 мл', locale === 'en' ? 'Face care' : 'Уход за лицом', '100371640', 3200, 650, 150, 120, 21, 12]]);
  products['!cols'] = h.products.map((header) => ({ wch: Math.max(14, header.length + 4) }));
  XLSX.utils.book_append_sheet(workbook, products, h.sheets[1]);
  const orders = XLSX.utils.aoa_to_sheet([h.orders, ['700000001', today, 'KS-1001', locale === 'en' ? 'Moisturising cream 50 ml' : 'Крем увлажняющий 50 мл', 1, 8900, locale === 'en' ? 'Completed' : 'Выдан']]);
  orders['!cols'] = h.orders.map((header) => ({ wch: Math.max(14, header.length + 4) }));
  XLSX.utils.book_append_sheet(workbook, orders, h.sheets[2]);
  const ads = XLSX.utils.aoa_to_sheet([h.ads, [today, 'KS-1001', locale === 'en' ? 'Kaspi Ads' : 'Kaspi Реклама', 9000]]);
  ads['!cols'] = h.ads.map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(workbook, ads, h.sheets[3]);
  XLSX.writeFile(workbook, locale === 'en' ? 'reflect-template.xlsx' : 'reflect-shablon.xlsx');
}
