import type { SourceMessageKey } from '@workspace/api-client-react';
import type { Triple } from './types';

/** Status messages the API returns as SourceMessageKey. Typed against the API enum, so a new key fails typecheck until translated here. */
export const source: Record<SourceMessageKey, Triple> = {
  "connector.kaspi.connected": ["Токен работает. Нажмите «Обновить данные», чтобы загрузить заказы.", "Токен жұмыс істейді. Тапсырыстарды жүктеу үшін «Деректерді жаңарту» басыңыз.", "The token works. Press “Sync now” to load orders."],
  "connector.kaspi.invalid_token": ["Kaspi не принял токен. Проверьте его в кабинете продавца.", "Kaspi токенді қабылдамады. Оны сатушы кабинетінде тексеріңіз.", "Kaspi rejected the token. Check it in your seller account."],
  "connector.kaspi.unavailable": ["Kaspi сейчас не отвечает. Попробуйте позже.", "Kaspi қазір жауап бермейді. Кейінірек көріңіз.", "Kaspi is not responding. Try again later."],
  "connector.kaspi.sign_in": ["Войдите, чтобы подключить Kaspi.", "Kaspi-ді қосу үшін кіріңіз.", "Sign in to connect Kaspi."],
  "connector.moysklad.connected": ["Токен работает. Нажмите «Обновить данные», чтобы загрузить остатки и себестоимость.", "Токен жұмыс істейді. Қалдықтар мен өзіндік құнды жүктеу үшін «Деректерді жаңарту» басыңыз.", "The token works. Press “Sync now” to load stock and cost prices."],
  "connector.moysklad.invalid_token": ["МойСклад не принял токен.", "МойСклад токенді қабылдамады.", "MoySklad rejected the token."],
  "connector.moysklad.unavailable": ["МойСклад сейчас не отвечает. Попробуйте позже.", "МойСклад қазір жауап бермейді. Кейінірек көріңіз.", "MoySklad is not responding. Try again later."],
  "connector.mcp.connected": ["Сервер подключён.", "Сервер қосылды.", "Server connected."],
  "connector.mcp.unauthorized": ["Сервер отклонил ключ.", "Сервер кілтті қабылдамады.", "The server rejected the key."],
  "connector.mcp.unavailable": ["Сервер не отвечает или это не MCP-сервер.", "Сервер жауап бермейді немесе бұл MCP сервер емес.", "The server is not responding or is not an MCP server."],
  "connector.mcp.unsafe_url": ["Нужен публичный адрес по HTTPS.", "HTTPS арқылы жария мекенжай қажет.", "A public HTTPS address is required."],
  "connector.redstat.unavailable": ["RedStat временно не отдаёт данные. Повторите позже.", "RedStat уақытша деректерді бермейді. Кейінірек қайталаңыз.", "RedStat is temporarily not returning data. Try later."],
  "connector.redstat.connect_in_settings": ["RedStat не подключён. Подключите его в настройках.", "RedStat қосылмаған. Оны баптауларда қосыңыз.", "RedStat is not connected. Connect it in Settings."],
  "connector.not_connected": ["Не подключено.", "Қосылмаған.", "Not connected."],
  "connector.sync.done": ["Данные обновлены.", "Деректер жаңартылды.", "Data synced."],
  "connector.sync.truncated": ["Загружены последние 3000 заказов. Остальные добавьте файлом.", "Соңғы 3000 тапсырыс жүктелді. Қалғандарын файлмен қосыңыз.", "The latest 3,000 orders were loaded. Add the rest from a file."],
  "connector.sync.interrupted": ["Обновление прервалось, не завершившись. Запустите его ещё раз.", "Жаңарту аяқталмай үзілді. Оны қайта іске қосыңыз.", "The sync stopped before finishing. Run it again."],
  "connector.encryption.reset": ["Ключ шифрования сервера изменился. Введите ключ заново.", "Сервердің шифрлау кілті өзгерді. Кілтті қайта енгізіңіз.", "The server encryption key changed. Enter the key again."],
  "connector.kaspi.not_connected": ["Добавьте серверный токен, чтобы проверить реальное подключение.", "Нақты қосылымды тексеру үшін серверлік токен қосыңыз.", "Add a server-side token to test a real connection."],
  "connector.demo.active": ["Демо-коннектор активен.", "Демо-коннектор белсенді.", "Demo connector active."],
  "connector.redstat.methods_unconfirmed": ["Интерфейс коннектора готов; сначала нужно подтвердить доступность live-методов.", "Коннектор интерфейсі дайын; алдымен live әдістерінің қолжетімділігін растау қажет.", "Connector interface is ready; live method availability must be confirmed first."],
  "connector.kaspi.demo_endpoint_unconfigured": ["Токен получен на сервере, но официальный endpoint не настроен в демо-режиме.", "Токен сервер жағында алынды, бірақ ресми endpoint Demo режимінде бапталмаған.", "The token was received server-side, but the official endpoint is not configured in Demo Mode."],
  "connector.kaspi.token_required": ["Для проверки коннектора нужен токен.", "Коннекторды тексеру үшін токен қажет.", "A token is required to test the connector."],
  "connector.kaspi.coming_soon": ["Прямое подключение появится позже. Сейчас можно загрузить отчёт продаж из файла.", "Тікелей қосылым кейінірек пайда болады. Қазір сату есебін файлдан жүктеуге болады.", "A direct connection is coming later. You can upload a sales report from a file now."],
};
