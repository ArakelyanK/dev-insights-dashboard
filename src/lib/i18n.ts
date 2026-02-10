// Russian localization for UI labels
// Metric names and Azure DevOps state names remain in English

export const labels = {
  // Page titles
  analysisResults: 'Результаты анализа',
  analyzedWorkItems: 'Проанализировано {count} рабочих элементов',
  newAnalysis: 'Новый анализ',
  
  // Summary cards
  totalWorkItems: 'Всего рабочих элементов',
  avgDevTime: 'Среднее время разработки (Active)',
  activeStatePerTask: 'Состояние Active на задачу',
  totalReturns: 'Всего возвратов',
  itemsSentToFixRequired: 'Элементов возвращено в Fix Required',
  prComments: 'Комментарии к PR',
  commentsFromLinkedPrs: 'Комментарии из связанных PR',
  avgDevTestTime: 'Среднее время DEV тестирования',
  avgStgTestTime: 'Среднее время STG тестирования',
  devInTestingPerTask: 'DEV_In Testing на задачу',
  stgInTestingPerTask: 'STG_In Testing на задачу',
  
  // Story Points
  storyPointsAnalytics: 'Аналитика Story Points',
  avgStoryPoints: 'Средний SP',
  avgStoryPointsDesc: 'Средний Original Estimate',
  costPerSp: 'Стоимость 1 SP',
  costPerSpDesc: 'Рабочих часов на 1 Story Point',
  itemsWithEstimate: 'С оценкой',
  itemsWithoutEstimate: 'Без оценки',
  fibonacciBreakdown: 'Разбивка по Story Points',
  avgHoursPerSp: 'Ср. часов/SP',
  avgActiveHoursPerTask: 'Ср. часов Active/задачу',
  itemCount: 'Элементов',
  totalHours: 'Всего часов',
  
  // Work item breakdown
  workItemBreakdown: 'Распределение рабочих элементов',
  requirements: 'Требования',
  bugs: 'Баги',
  tasks: 'Задачи',
  tasksForPrOnly: 'Задачи (только PR комментарии)',
  
  // Tabs
  tables: 'Таблицы',
  charts: 'Графики',
  
  // Developer metrics table
  developerMetrics: 'Метрики разработчиков',
  developer: 'Разработчик',
  avgDevTimeActive: 'Среднее время (Active)',
  itemsCompleted: 'Завершено элементов',
  totalReturnsShort: 'Всего возвратов',
  avgReturnsPerTask: 'Сред. возвратов/задачу',
  codeReviewFix: 'Code Review → Fix',
  avgCrFixPerTask: 'Сред. CR Fix/задачу',
  devTestFix: 'DEV Test → Fix',
  avgDevFixPerTask: 'Сред. DEV Fix/задачу',
  stgTestFix: 'STG Test → Fix',
  avgStgFixPerTask: 'Сред. STG Fix/задачу',
  avgOriginalEstimate: 'Сред. SP',
  filterDevelopers: 'Фильтр разработчиков',
  selectDevelopers: 'Выбрать разработчиков',
  clearAll: 'Очистить все',
  clearFilters: 'Очистить фильтры',
  noDeveloperMetrics: 'Нет данных по разработчикам',
  
  // Tester metrics table
  testerMetrics: 'Метрики тестировщиков',
  tester: 'Тестировщик',
  closedItems: 'Закрытых элементов',
  avgDevTestTimeShort: 'Среднее DEV тест',
  avgStgTestTimeShort: 'Среднее STG тест',
  devIterations: 'DEV итерации',
  avgDevIterPerTask: 'Сред. DEV итер./задачу',
  stgIterations: 'STG итерации',
  avgStgIterPerTask: 'Сред. STG итер./задачу',
  prCommentsShort: 'Комментарии PR',
  avgCommentsPerPr: 'Сред. комм./PR',
  filterTesters: 'Фильтр тестировщиков',
  selectTesters: 'Выбрать тестировщиков',
  noTesterMetrics: 'Нет данных по тестировщикам',
  
  // Charts
  avgDevTimeChart: 'Среднее время разработки (Active)',
  avgDevTestTimeChart: 'Среднее время DEV тестирования',
  avgStgTestTimeChart: 'Среднее время STG тестирования',
  returnsToFixRequired: 'Возвраты в Fix Required',
  devIterationsPerTester: 'DEV итерации по тестировщикам',
  stgIterationsPerTester: 'STG итерации по тестировщикам',
  prCommentsByAuthor: 'Комментарии PR по авторам',
  storyPointsCostChart: 'Стоимость Story Points по размеру',
  showTestersOnly: 'Только тестировщики',
  noTesterPrComments: 'Нет комментариев от тестировщиков',
  hours: 'Часы',
  count: 'Кол-во',
  fullscreen: 'Полный экран',
  exitFullscreen: 'Выйти из полноэкранного режима',
  
  // Drill-down modal
  workItemDetails: 'Детали рабочих элементов',
  workItemId: 'ID',
  title: 'Название',
  type: 'Тип',
  metricCount: 'Значение',
  assignedToChanged: 'Изменился исполнитель',
  assignedToHistory: 'История назначений',
  activeTime: 'Время Active',
  devTestTime: 'DEV тест',
  stgTestTime: 'STG тест',
  originalEstimate: 'SP',
  yes: 'Да',
  no: 'Нет',
  close: 'Закрыть',
  openInAdo: 'Открыть в Azure DevOps',
  clickToViewDetails: 'Нажмите для просмотра деталей',
  items: 'элементов',
  total: 'Итого',
  
  // PR drill-down
  prDetails: 'Детали Pull Requests',
  prId: 'PR ID',
  workItem: 'Рабочий элемент',
  commentsCount: 'Комментариев',
  authors: 'Авторы',
  openPr: 'Открыть PR',
  
  // Unassigned
  unassigned: 'Неназначено',
  unassignedItems: 'Неназначенные элементы',
  viewUnassigned: 'Просмотреть неназначенные',
  
  // Form
  azureDevOpsAnalytics: 'Azure DevOps Аналитика',
  analyzeDescription: 'Анализ метрик разработки и тестирования из ваших рабочих элементов Azure DevOps.',
  organization: 'Организация',
  project: 'Проект',
  queryUrlOrId: 'URL запроса или ID',
  queryPlaceholder: 'https://dev.azure.com/org/project/_queries/query/... или GUID запроса',
  queryHint: 'Введите полный URL сохраненного запроса или только ID запроса (GUID)',
  pat: 'Personal Access Token (PAT)',
  enterPat: 'Введите ваш Azure DevOps PAT',
  patSecurityNote: 'Ваш PAT используется только для этого запроса и никогда не сохраняется.',
  analyzeMetrics: 'Анализировать метрики',
  analyzing: 'Анализ...',
  
  // Validation errors
  organizationRequired: 'Организация обязательна',
  projectRequired: 'Проект обязателен',
  queryRequired: 'URL запроса или ID обязателен',
  patRequired: 'Personal Access Token обязателен',
  patInvalid: 'PAT недействителен (слишком короткий)',
  
  // Security info
  securityPrivacy: 'Безопасность и конфиденциальность',
  securityNote1: 'Ваш PAT используется только для этого запроса и никогда не сохраняется',
  securityNote2: 'Все API вызовы выполняются через защищенный backend прокси',
  securityNote3: 'Никакие данные не сохраняются после завершения анализа',
  securityNote4: 'Данные рабочих элементов обрабатываются только в памяти',
  
  // Metrics info
  metricsCalculated: 'Рассчитываемые метрики',
  developerMetricsInfo: 'Метрики разработчика',
  developmentSpeed: 'Скорость разработки (Active → Code Review)',
  returnCount: 'Количество возвратов (элементы в Fix Required)',
  returnsBySource: 'Возвраты по источнику (Code Review, DEV, STG)',
  testerMetricsInfo: 'Метрики тестировщика',
  closedItemsCountInfo: 'Количество закрытых элементов (Released)',
  testingSpeed: 'Скорость тестирования (DEV & STG окружения)',
  testingIterations: 'Итерации тестирования по окружениям',
  prCommentsAuthored: 'Написанные PR комментарии',
  
  // Header
  secureAnalysis: 'Защищенный анализ',
  developmentTestingMetrics: 'Метрики разработки и тестирования',
  
  // Footer
  footerNote: 'Azure DevOps Analytics POC • Все расчёты основаны на истории ревизий Work Item',
  
  // Analysis status
  analysisComplete: 'Анализ завершён',
  analysisSuccessful: 'Успешно проанализировано {count} рабочих элементов.',
  analysisFailed: 'Ошибка анализа',
  analysisError: 'Ошибка анализа',
  
  // Limitation warnings
  resultsLimited: 'Результаты ограничены',
  resultsLimitedDesc: 'Запрос вернул {original} элементов. Показаны первые {limited} для предотвращения таймаута.',
  prCommentsSkipped: 'Комментарии PR пропущены',
  prCommentsSkippedDesc: 'Для больших запросов анализ PR комментариев пропущен для экономии времени.',
  useNarrowerQuery: 'Используйте более узкий запрос для полных результатов.',
  
  // Filtering
  filters: 'Фильтры',
  filterByType: 'Фильтр по типу',
  filterByState: 'Фильтр по состоянию',
  filterByDateRange: 'Фильтр по дате',
  stateFilter: 'Переход в состояние',
  fromDate: 'С даты',
  toDate: 'По дату',
  applyFilters: 'Применить',
  resetFilters: 'Сбросить',
  activeFilters: 'Активные фильтры',
  noFilters: 'Фильтры не применены',
  workItemTypes: 'Типы элементов',
  allTypes: 'Все типы',
  
  // Working time info
  workingTimeInfo: 'Время рассчитывается с учетом рабочего календаря',
  workingHours: 'Рабочие часы: 09:00-18:00 (UTC+3)',
  excludedDays: 'Исключены: выходные и праздничные дни',
} as const;

export type LabelKey = keyof typeof labels;

export function t(key: LabelKey, params?: Record<string, string | number>): string {
  let text = labels[key];
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v)) as typeof text;
    });
  }
  return text;
}
