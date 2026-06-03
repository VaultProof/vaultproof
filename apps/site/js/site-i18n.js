(function () {
  'use strict';

  if (window.VP_I18N && window.VP_I18N.ready) return;

  var DEFAULT_LOCALE = 'en';
  var SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de', 'pt-BR', 'ru', 'he', 'ja', 'zh-CN'];
  var LOCALE_LABELS = {
    en: 'English',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    'pt-BR': 'Português',
    ru: 'Русский',
    he: 'עברית',
    ja: '日本語',
    'zh-CN': '简体中文'
  };
  var DEEPL_TARGET_LOCALES = {
    es: true,
    fr: true,
    de: true,
    'pt-BR': true,
    ru: true,
    he: true,
    ja: true,
    'zh-CN': true
  };
  var LOCALE_STORAGE_KEY = 'vp_locale';
  var TRANSLATE_API_URL = (window.location.hostname.indexOf('dev.vaultproof') !== -1)
    ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/site/translate'
    : 'https://init.vaultproof.dev/api/v1/site/translate';
  var MAX_TRANSLATION_NODES = 260;
  var MAX_TRANSLATION_BATCH = 60;
  var MAX_TRANSLATION_CHARS = 12000;
  var translationCache = {};
  var originalTextByNode = new WeakMap();
  var translatedNodeSet = new WeakSet();
  var translatedNodes = [];
  var machineTranslationQueued = false;
  var isApplyingMachineTranslation = false;
  var suppressMachineTranslationObserver = false;
  var translationGeneration = 0;

  var MESSAGES = {
    en: {
      'label.language': 'Language',
      'nav.scanner': 'scanner',
      'nav.docs': 'docs',
      'nav.insights': 'insights',
      'nav.pricing': 'pricing',
      'nav.signIn': 'sign in',
      'nav.getStarted': 'get started',
      'nav.support': 'support',
      'nav.menu': 'menu',
      'nav.close': 'close',
      'common.loading': 'loading…',
      'common.live': 'live',
      'common.refresh': 'refresh',
      'common.exportCsv': 'export csv',
      'common.currentPlan': 'Current Plan',
      'common.manageBilling': 'Manage Billing',
      'app.dashboard': 'Dashboard',
      'app.projects': 'Dashboard',
      'app.activity': 'Activity Logs',
      'app.alerts': 'alerts',
      'app.keys': 'Protected Keys',
      'app.settings': 'Security Controls',
      'app.plans': 'Plans & Billing',
      'app.repos': 'Repository Scanner',
      'app.help': 'help',
      'app.signOut': 'sign out',
      'app.planLoading': 'plan loading',
      'app.allCalls': 'all calls',
      'app.overview': 'Monitor',
      'app.vault': 'Manage',
      'app.scanner': 'Scan',
      'home.title': 'VaultProof | API key security built for the age of AI agents.',
      'home.heroEyebrow': 'A safer home for your API keys',
      'home.heroTitle': 'Stop shipping secrets<br>in plain text.',
      'home.heroSub': "We find the keys scattered across your repo, split them so no single database holds a whole one, and quietly proxy your API calls. Your SDK doesn't know the difference.",
      'home.heroLink': 'How it works →',
      'home.copyHint': '⌘ C',
      'home.copied': 'copied!',
      'scan.title': 'Public Repo Scanner | VaultProof',
      'scan.eyebrow': '00 / Public repo scanner',
      'scan.heroTitle': 'Find exposed API keys before they become incidents.',
      'scan.heroSub': 'Paste a public GitHub repo and VaultProof checks current files, recent history, risky config, and security hygiene in the same restrained system as the main dashboard.',
      'scan.proofSecrets': 'secrets',
      'scan.proofSecretsCopy': 'Detect API keys across LLM, cloud, payment, email, database, and observability providers.',
      'scan.proofHistory': 'history',
      'scan.proofHistoryCopy': 'Search recent commits so leaked values do not hide in old snapshots.',
      'scan.proofHygiene': 'hygiene',
      'scan.proofHygieneCopy': 'Flag risky files, weak patterns, and missing project guardrails.',
      'scan.kicker': 'free / no login',
      'scan.cardTitle': 'Scan a repo',
      'scan.button': 'Scan repo',
      'scan.examplePrefix': 'Example:',
      'scan.limits': 'Scans up to 500 files and 50 commits of history.',
      'scan.sectionLabel': '01 / What gets checked',
      'scan.sectionTitle': 'A quick public pass across secrets, risky files, code smells, and repo hygiene.',
      'docs.browserTitle': 'Developer Documentation | VaultProof',
      'docs.heroTitle': 'VaultProof Documentation',
      'docs.heroSub': 'Everything you need to store, protect, and proxy your API keys and secrets with split-key security.',
      'blog.browserTitle': 'VaultProof Insights',
      'blog.heroEyebrow': 'VaultProof Insights',
      'blog.heroTitle': 'Security notes for people shipping with keys.',
      'blog.heroSub': 'API key leaks, supply-chain incidents, MCP config risks, and practical architecture notes from the VaultProof team.',
      'blog.latestNote': 'Latest briefing: exposed keys, agent workflows, and the path away from plaintext secrets.',
      'blog.sectionLabel': '01 / Library',
      'blog.sectionTitle': 'Recent security writing.',
      'blog.sectionSub': 'Field guides and incident notes for teams trying to keep secrets out of repos, agents, CI, and runtime logs.',
      'login.browserTitle': 'Login | VaultProof',
      'login.eyebrow': 'Active Key Protection',
      'login.introTitle': 'Sign in without handing apps the raw key.',
      'login.introSub': 'Manage split-key projects, third-party provider routes, scanner findings, and proxy activity from the same dark control plane.',
      'login.authKicker': 'dashboard access',
      'login.authTitle': 'Sign in to VaultProof',
      'login.authSub': 'Route into the right workspace for protected API keys, proxy tokens, scans, and team controls.',
      'login.promoToggle': '+ have a promo code?',
      'login.promoApply': 'apply',
      'login.github': 'continue with github',
      'login.google': 'continue with google',
      'login.orEmail': 'or email',
      'login.createAccount': 'create account',
      'login.forgotPassword': 'forgot password?',
      'login.resetCopy': "Enter your email and we'll send a reset link.",
      'login.sendReset': 'send reset link',
      'login.backToSignIn': 'back to sign in',
      'login.legal': 'By signing up, you agree to our Terms and Privacy Policy.',
      'login.backLink': '← back to VaultProof',
      'login.sharesEncrypted': 'shares encrypted at rest',
      'login.sessionExpired': 'Session Expired',
      'login.sessionExpiredCopy': 'Your session has expired. Please sign in again to continue.',
      'login.signInAgain': 'Sign In Again',
      'login.placeholder.email': 'you@example.com',
      'login.placeholder.password': 'password',
      'login.placeholder.code': 'ENTER CODE',
      'login.placeholder.minChars': 'min 8 characters',
      'dashboard.browserTitle': 'Production Gateway — VaultProof',
      'dashboard.title': 'Production gateway',
      'dashboard.keysUnderVault': 'requests today',
      'dashboard.proxiedCalls': 'p99 latency',
      'dashboard.activeProviders': 'success rate',
      'dashboard.errorRate': 'active routes',
      'dashboard.proxyCalls30d': 'proxy calls · 30d',
      'dashboard.calls': 'calls',
      'dashboard.errors': 'errors',
      'dashboard.sort': 'sort · route activity ↓',
      'dashboard.filter.all': 'all',
      'dashboard.filter.production': 'production',
      'dashboard.filter.staging': 'staging',
      'dashboard.filter.development': 'development',
      'dashboard.filter.idle': 'idle',
      'dashboard.recentActivity': 'recent activity',
      'dashboard.openAlerts': 'open alerts',
      'dashboard.encryptedAtRest': 'encrypted at rest',
      'dashboard.noRecentActivity': 'no recent activity',
      'dashboard.noProjects': 'No projects match this filter.',
      'dashboard.clear': 'clear',
      'dashboard.needsReview': 'needs review',
      'dashboard.noOpenScannerAlerts': 'No open scanner alerts',
      'dashboard.runScan': 'run a repo scan to surface findings here',
      'dashboard.scannerHistory': 'scanner history',
      'dashboard.unavailable': 'unavailable',
      'activity.browserTitle': 'Activity — VaultProof',
      'activity.title': 'Activity',
      'activity.desc': 'Review proxied traffic across every project: successful requests, failures, hot endpoints, provider mix, and the exact calls that need attention.',
      'activity.chartNote': 'calls vs errors',
      'activity.stream': 'request stream',
      'activity.endpoints': 'busiest endpoints',
      'activity.errors': 'recent errors',
      'activity.dataUnavailable': 'activity data unavailable',
      'activity.couldNotLoad': 'could not load activity',
      'activity.weCouldNotLoad': 'We could not load activity right now.',
      'activity.loading': 'loading activity…',
      'activity.allProjects': 'all projects',
      'activity.noEndpoints': 'No endpoint activity yet.',
      'alerts.browserTitle': 'Alerts — VaultProof',
      'alerts.title': 'Alerts',
      'alerts.desc': 'Keep one queue for leaked-secret findings, failing proxy routes, and recurring trouble spots. Triage by severity, source, project, and latest detection without bouncing between scanner and runtime views.',
      'alerts.chartNote': 'scanner vs runtime',
      'alerts.queue': 'alert queue',
      'alerts.severity': 'severity mix',
      'alerts.surface': 'affected surfaces',
      'alerts.recent': 'latest detections',
      'alerts.unavailable': 'alerts unavailable',
      'alerts.couldNotLoad': 'could not load alerts',
      'alerts.weCouldNotLoad': 'We could not load alerts right now.',
      'alerts.loading': 'loading alerts…',
      'alerts.search': 'Search by repo, project, endpoint, provider, or alert text',
      'alerts.allSources': 'all sources',
      'alerts.allSeverity': 'all severity',
      'alerts.allSurfaces': 'all surfaces',
      'alerts.noMatches': 'No alerts match the current filters.',
      'alerts.projectsFailing': 'projects with failing routes',
      'alerts.noRuntime': 'no runtime incidents',
      'alerts.reposFindings': 'repositories with exposed findings',
      'alerts.queueClear': 'scanner queue is clear',
      'keys.browserTitle': 'API Keys - VaultProof',
      'keys.title': 'API Keys',
      'keys.desc': 'Create projects, split provider keys in-browser, rotate encrypted shares, and copy project IDs for your SDK configuration.',
      'settings.browserTitle': 'Settings — VaultProof',
      'settings.title': 'Settings',
      'settings.subtitle': 'Manage your account, security, and preferences',
      'plans.browserTitle': 'Plans — VaultProof',
      'plans.title': 'Plans & Billing',
      'plans.subtitle': 'Upgrade, downgrade, or manage your subscription.',
      'plans.upgradeTo': 'Upgrade to {tier}',
      'scanner.browserTitle': 'Scanner — VaultProof',
      'scanner.appTitle': 'Scanner',
      'scanner.appSubtitle': 'Scan repos for exposed API keys',
      'scanner.connectedTitle': 'Scan your repos for exposed API keys'
    },
    es: {
      'label.language': 'Idioma',
      'nav.scanner': 'escáner',
      'nav.docs': 'docs',
      'nav.insights': 'insights',
      'nav.pricing': 'precios',
      'nav.signIn': 'iniciar sesión',
      'nav.getStarted': 'empezar',
      'nav.support': 'soporte',
      'nav.menu': 'menú',
      'nav.close': 'cerrar',
      'common.loading': 'cargando…',
      'common.live': 'en vivo',
      'common.refresh': 'actualizar',
      'common.exportCsv': 'exportar csv',
      'common.currentPlan': 'Plan actual',
      'common.manageBilling': 'Gestionar facturación',
      'app.dashboard': 'panel',
      'app.projects': 'proyectos',
      'app.activity': 'actividad',
      'app.alerts': 'alertas',
      'app.keys': 'claves',
      'app.settings': 'ajustes',
      'app.plans': 'planes',
      'app.repos': 'repos',
      'app.help': 'ayuda',
      'app.signOut': 'cerrar sesión',
      'app.planLoading': 'cargando plan',
      'app.allCalls': 'todas las llamadas',
      'app.overview': 'resumen',
      'app.vault': 'vault',
      'app.scanner': 'escáner',
      'home.title': 'VaultProof | Seguridad de claves API para la era de los agentes de IA.',
      'home.heroEyebrow': 'Un hogar más seguro para tus claves API',
      'home.heroTitle': 'Deja de enviar secretos<br>en texto plano.',
      'home.heroSub': 'Encontramos las claves repartidas por tu repositorio, las dividimos para que ninguna base de datos tenga una completa y enviamos tus llamadas API por proxy en silencio. Tu SDK ni lo nota.',
      'home.heroLink': 'Cómo funciona →',
      'home.copyHint': '⌘ C',
      'home.copied': '¡copiado!',
      'scan.title': 'Escáner público de repos | VaultProof',
      'scan.eyebrow': '00 / Escáner público de repos',
      'scan.heroTitle': 'Encuentra claves API expuestas antes de que se conviertan en incidentes.',
      'scan.heroSub': 'Pega un repositorio público de GitHub y VaultProof revisa archivos actuales, historial reciente, configuración riesgosa e higiene de seguridad en el mismo sistema sobrio del panel principal.',
      'scan.proofSecrets': 'secretos',
      'scan.proofSecretsCopy': 'Detecta claves API de proveedores de LLM, nube, pagos, correo, bases de datos y observabilidad.',
      'scan.proofHistory': 'historial',
      'scan.proofHistoryCopy': 'Busca en commits recientes para que los valores filtrados no se escondan en snapshots antiguos.',
      'scan.proofHygiene': 'higiene',
      'scan.proofHygieneCopy': 'Marca archivos riesgosos, patrones débiles y protecciones de proyecto faltantes.',
      'scan.kicker': 'gratis / sin login',
      'scan.cardTitle': 'Escanear un repo',
      'scan.button': 'Escanear repo',
      'scan.examplePrefix': 'Ejemplo:',
      'scan.limits': 'Escanea hasta 500 archivos y 50 commits del historial.',
      'scan.sectionLabel': '01 / Qué se revisa',
      'scan.sectionTitle': 'Una pasada pública rápida por secretos, archivos riesgosos, olores de código e higiene del repositorio.',
      'docs.browserTitle': 'Documentación para desarrolladores | VaultProof',
      'docs.heroTitle': 'Documentación de VaultProof',
      'docs.heroSub': 'Todo lo que necesitas para guardar, proteger y enviar por proxy tus claves API y secretos con seguridad de clave dividida.',
      'blog.browserTitle': 'VaultProof Insights',
      'blog.heroEyebrow': 'VaultProof Insights',
      'blog.heroTitle': 'Notas de seguridad para equipos que trabajan con claves.',
      'blog.heroSub': 'Fugas de claves API, incidentes de cadena de suministro, riesgos en config de MCP y notas prácticas de arquitectura del equipo de VaultProof.',
      'blog.latestNote': 'Último informe: claves expuestas, flujos con agentes y el camino fuera de los secretos en texto plano.',
      'blog.sectionLabel': '01 / Biblioteca',
      'blog.sectionTitle': 'Escritura reciente de seguridad.',
      'blog.sectionSub': 'Guías e incidentes para equipos que intentan mantener secretos fuera de repos, agentes, CI y logs de ejecución.',
      'login.browserTitle': 'Acceso | VaultProof',
      'login.eyebrow': '00 / Acceso seguro',
      'login.introTitle': 'Entra al vault. Mantén las claves fuera.',
      'login.introSub': 'Inicia sesión para gestionar proyectos con claves divididas, proxy de proveedores, bloqueos de origen y logs de actividad desde el mismo sistema que mantiene las claves API completas fuera de tus apps.',
      'login.authKicker': 'acceso al panel',
      'login.authTitle': 'Inicia sesión en VaultProof',
      'login.authSub': 'Gestiona claves, proxies, escaneos y facturación desde un único espacio sellado.',
      'login.promoToggle': '+ ¿tienes un código promocional?',
      'login.promoApply': 'aplicar',
      'login.github': 'continuar con github',
      'login.google': 'continuar con google',
      'login.orEmail': 'o por correo',
      'login.createAccount': 'crear cuenta',
      'login.forgotPassword': '¿olvidaste tu contraseña?',
      'login.resetCopy': 'Escribe tu correo y te enviaremos un enlace para restablecerla.',
      'login.sendReset': 'enviar enlace',
      'login.backToSignIn': 'volver a iniciar sesión',
      'login.legal': 'Al registrarte, aceptas nuestros Términos y la Política de privacidad.',
      'login.backLink': '← volver a VaultProof',
      'login.sharesEncrypted': 'fragmentos cifrados en reposo',
      'login.sessionExpired': 'Sesión expirada',
      'login.sessionExpiredCopy': 'Tu sesión expiró. Vuelve a iniciar sesión para continuar.',
      'login.signInAgain': 'Iniciar sesión de nuevo',
      'login.placeholder.email': 'tu@ejemplo.com',
      'login.placeholder.password': 'contraseña',
      'login.placeholder.code': 'INTRODUCE EL CÓDIGO',
      'login.placeholder.minChars': 'mínimo 8 caracteres',
      'dashboard.browserTitle': 'Gateway de producción — VaultProof',
      'dashboard.title': 'Gateway de producción',
      'dashboard.keysUnderVault': 'solicitudes hoy',
      'dashboard.proxiedCalls': 'latencia p99',
      'dashboard.activeProviders': 'tasa de éxito',
      'dashboard.errorRate': 'rutas activas',
      'dashboard.proxyCalls30d': 'llamadas proxy · 30d',
      'dashboard.calls': 'llamadas',
      'dashboard.errors': 'errores',
      'dashboard.sort': 'ordenar · actividad de rutas ↓',
      'dashboard.filter.all': 'todo',
      'dashboard.filter.production': 'producción',
      'dashboard.filter.staging': 'staging',
      'dashboard.filter.development': 'desarrollo',
      'dashboard.filter.idle': 'inactivo',
      'dashboard.recentActivity': 'actividad reciente',
      'dashboard.openAlerts': 'alertas abiertas',
      'dashboard.encryptedAtRest': 'cifrado en reposo',
      'dashboard.noRecentActivity': 'sin actividad reciente',
      'dashboard.noProjects': 'Ningún proyecto coincide con este filtro.',
      'dashboard.clear': 'limpio',
      'dashboard.needsReview': 'requiere revisión',
      'dashboard.noOpenScannerAlerts': 'No hay alertas abiertas del escáner',
      'dashboard.runScan': 'ejecuta un escaneo del repo para ver hallazgos aquí',
      'dashboard.scannerHistory': 'historial del escáner',
      'dashboard.unavailable': 'no disponible',
      'activity.browserTitle': 'Actividad — VaultProof',
      'activity.title': 'Actividad',
      'activity.desc': 'Revisa el tráfico proxy de todos los proyectos: solicitudes correctas, fallos, endpoints más calientes, mezcla de proveedores y las llamadas exactas que necesitan atención.',
      'activity.chartNote': 'llamadas vs errores',
      'activity.stream': 'flujo de solicitudes',
      'activity.endpoints': 'endpoints más activos',
      'activity.errors': 'errores recientes',
      'activity.dataUnavailable': 'datos de actividad no disponibles',
      'activity.couldNotLoad': 'no se pudo cargar la actividad',
      'activity.weCouldNotLoad': 'No pudimos cargar la actividad ahora mismo.',
      'activity.loading': 'cargando actividad…',
      'activity.allProjects': 'todos los proyectos',
      'activity.noEndpoints': 'Todavía no hay actividad de endpoints.',
      'alerts.browserTitle': 'Alertas — VaultProof',
      'alerts.title': 'Alertas',
      'alerts.desc': 'Mantén una única cola para hallazgos de secretos filtrados, rutas proxy con fallos y puntos problemáticos recurrentes. Prioriza por severidad, fuente, proyecto y última detección sin saltar entre escáner y runtime.',
      'alerts.chartNote': 'escáner vs runtime',
      'alerts.queue': 'cola de alertas',
      'alerts.severity': 'mezcla de severidad',
      'alerts.surface': 'superficies afectadas',
      'alerts.recent': 'últimas detecciones',
      'alerts.unavailable': 'alertas no disponibles',
      'alerts.couldNotLoad': 'no se pudieron cargar las alertas',
      'alerts.weCouldNotLoad': 'No pudimos cargar las alertas ahora mismo.',
      'alerts.loading': 'cargando alertas…',
      'alerts.search': 'Buscar por repo, proyecto, endpoint, proveedor o texto de alerta',
      'alerts.allSources': 'todas las fuentes',
      'alerts.allSeverity': 'toda severidad',
      'alerts.allSurfaces': 'todas las superficies',
      'alerts.noMatches': 'No hay alertas que coincidan con los filtros actuales.',
      'alerts.projectsFailing': 'proyectos con rutas fallando',
      'alerts.noRuntime': 'sin incidentes de runtime',
      'alerts.reposFindings': 'repositorios con hallazgos expuestos',
      'alerts.queueClear': 'la cola del escáner está limpia',
      'keys.browserTitle': 'Claves API - VaultProof',
      'keys.title': 'Claves API',
      'keys.desc': 'Crea proyectos, divide claves de proveedor en el navegador, rota fragmentos cifrados y copia IDs de proyecto para la configuración de tu SDK.',
      'settings.browserTitle': 'Ajustes — VaultProof',
      'settings.title': 'Ajustes',
      'settings.subtitle': 'Gestiona tu cuenta, seguridad y preferencias',
      'plans.browserTitle': 'Planes — VaultProof',
      'plans.title': 'Planes y facturación',
      'plans.subtitle': 'Mejora, cambia o gestiona tu suscripción.',
      'plans.upgradeTo': 'Mejorar a {tier}',
      'scanner.browserTitle': 'Escáner — VaultProof',
      'scanner.appTitle': 'Escáner',
      'scanner.appSubtitle': 'Escanea repos en busca de claves API expuestas',
      'scanner.connectedTitle': 'Escanea tus repos en busca de claves API expuestas'
    }
  };

  MESSAGES.fr = JSON.parse(JSON.stringify(MESSAGES.en));
  Object.assign(MESSAGES.fr, {
    'label.language': 'Langue',
    'nav.scanner': 'scanner',
    'nav.docs': 'docs',
    'nav.pricing': 'tarifs',
    'nav.signIn': 'se connecter',
    'nav.getStarted': 'commencer',
    'nav.support': 'support',
    'nav.menu': 'menu',
    'nav.close': 'fermer',
    'common.loading': 'chargement…',
    'common.refresh': 'actualiser',
    'common.exportCsv': 'exporter csv',
    'common.currentPlan': 'Forfait actuel',
    'common.manageBilling': 'Gérer la facturation',
    'app.dashboard': 'tableau de bord',
    'app.projects': 'projets',
    'app.activity': 'activité',
    'app.alerts': 'alertes',
    'app.keys': 'clés',
    'app.settings': 'réglages',
    'app.plans': 'forfaits',
    'app.repos': 'repos',
    'app.help': 'aide',
    'app.signOut': 'se déconnecter',
    'app.planLoading': 'chargement du forfait',
    'app.allCalls': 'tous les appels',
    'home.title': "VaultProof | Sécurité des clés API pour l'ère des agents IA.",
    'home.heroEyebrow': 'Un endroit plus sûr pour vos clés API',
    'home.heroTitle': 'Arrêtez de livrer des secrets<br>en clair.',
    'home.heroSub': "Nous trouvons les clés éparpillées dans votre dépôt, nous les découpons pour qu'aucune base ne stocke une clé complète et nous faisons passer vos appels API par proxy en silence. Votre SDK ne voit pas la différence.",
    'home.heroLink': 'Voir le fonctionnement →',
    'home.copied': 'copié !',
    'scan.eyebrow': '00 / Scanner public de dépôt',
    'scan.heroTitle': "Repérez les clés API exposées avant qu'elles ne deviennent des incidents.",
    'scan.heroSub': 'Collez un dépôt GitHub public et VaultProof vérifie les fichiers actuels, l’historique récent, la configuration risquée et l’hygiène de sécurité dans le même système sobre que le tableau principal.',
    'scan.kicker': 'gratuit / sans connexion',
    'scan.cardTitle': 'Scanner un dépôt',
    'scan.button': 'Scanner le dépôt',
    'docs.heroTitle': 'Documentation VaultProof',
    'docs.heroSub': 'Tout ce dont vous avez besoin pour stocker, protéger et proxyfier vos clés API et secrets avec une sécurité à clé partagée.',
    'blog.heroTitle': 'Notes de sécurité pour les équipes qui expédient avec des clés.',
    'login.eyebrow': '00 / Accès sécurisé',
    'login.introTitle': 'Entrez dans le vault. Gardez les clés dehors.',
    'login.authTitle': 'Se connecter à VaultProof',
    'login.signInAgain': 'Se reconnecter',
    'dashboard.title': 'Projets',
    'activity.title': 'Activité',
    'alerts.title': 'Alertes',
    'settings.title': 'Réglages',
    'plans.title': 'Forfaits & facturation',
    'scanner.appTitle': 'Scanner'
  });
  MESSAGES.de = JSON.parse(JSON.stringify(MESSAGES.en));
  Object.assign(MESSAGES.de, {
    'label.language': 'Sprache',
    'nav.pricing': 'preise',
    'nav.signIn': 'anmelden',
    'nav.getStarted': 'loslegen',
    'nav.support': 'support',
    'nav.close': 'schließen',
    'common.loading': 'lädt…',
    'common.refresh': 'aktualisieren',
    'common.exportCsv': 'csv exportieren',
    'app.signOut': 'abmelden',
    'app.planLoading': 'tarif wird geladen',
    'home.heroEyebrow': 'Ein sichereres Zuhause für deine API-Schlüssel',
    'home.heroTitle': 'Keine Geheimnisse mehr<br>im Klartext ausliefern.',
    'scan.heroTitle': 'Finde offengelegte API-Schlüssel, bevor daraus Vorfälle werden.',
    'login.authTitle': 'Bei VaultProof anmelden',
    'dashboard.title': 'Projekte',
    'activity.title': 'Aktivität',
    'alerts.title': 'Warnungen',
    'settings.title': 'Einstellungen',
    'plans.title': 'Tarife & Abrechnung',
    'scanner.appTitle': 'Scanner'
  });
  MESSAGES['pt-BR'] = JSON.parse(JSON.stringify(MESSAGES.en));
  Object.assign(MESSAGES['pt-BR'], {
    'label.language': 'Idioma',
    'nav.pricing': 'preços',
    'nav.signIn': 'entrar',
    'nav.getStarted': 'começar',
    'nav.support': 'suporte',
    'common.loading': 'carregando…',
    'common.refresh': 'atualizar',
    'common.exportCsv': 'exportar csv',
    'app.signOut': 'sair',
    'app.planLoading': 'carregando plano',
    'home.heroEyebrow': 'Um lugar mais seguro para suas chaves de API',
    'home.heroTitle': 'Pare de enviar segredos<br>em texto puro.',
    'scan.heroTitle': 'Encontre chaves de API expostas antes que virem incidentes.',
    'login.authTitle': 'Entrar no VaultProof',
    'dashboard.title': 'Projetos',
    'activity.title': 'Atividade',
    'alerts.title': 'Alertas',
    'settings.title': 'Configurações',
    'plans.title': 'Planos e cobrança',
    'scanner.appTitle': 'Scanner'
  });
  MESSAGES.ru = JSON.parse(JSON.stringify(MESSAGES.en));
  Object.assign(MESSAGES.ru, {
    'label.language': 'Язык',
    'nav.pricing': 'цены',
    'nav.signIn': 'войти',
    'nav.getStarted': 'начать',
    'nav.support': 'поддержка',
    'nav.menu': 'меню',
    'nav.close': 'закрыть',
    'common.loading': 'загрузка…',
    'common.refresh': 'обновить',
    'common.exportCsv': 'экспорт csv',
    'common.currentPlan': 'Текущий план',
    'common.manageBilling': 'Управление оплатой',
    'app.dashboard': 'панель',
    'app.projects': 'проекты',
    'app.activity': 'активность',
    'app.alerts': 'оповещения',
    'app.keys': 'ключи',
    'app.settings': 'настройки',
    'app.plans': 'планы',
    'app.repos': 'репозитории',
    'app.help': 'помощь',
    'app.signOut': 'выйти',
    'app.planLoading': 'загрузка плана',
    'app.allCalls': 'все вызовы',
    'home.heroEyebrow': 'Более безопасный дом для ваших API-ключей',
    'home.heroTitle': 'Перестаньте выкладывать секреты<br>в открытом виде.',
    'home.heroSub': 'Мы находим ключи по всему репозиторию, делим их так, чтобы ни одна база не хранила полный ключ, и тихо проксируем ваши API-вызовы. Ваш SDK даже не заметит разницы.',
    'home.heroLink': 'Как это работает →',
    'home.copied': 'скопировано!',
    'scan.title': 'Публичный сканер репозиториев | VaultProof',
    'scan.eyebrow': '00 / Публичный сканер репозиториев',
    'scan.heroTitle': 'Находите раскрытые API-ключи до того, как они станут инцидентами.',
    'scan.heroSub': 'Вставьте публичный GitHub-репозиторий, и VaultProof проверит текущие файлы, недавнюю историю, рискованные конфиги и гигиену безопасности в той же системе, что и основной дашборд.',
    'scan.kicker': 'бесплатно / без входа',
    'scan.cardTitle': 'Сканировать репозиторий',
    'scan.button': 'Сканировать репозиторий',
    'docs.browserTitle': 'Документация для разработчиков | VaultProof',
    'docs.heroTitle': 'Документация VaultProof',
    'docs.heroSub': 'Все, что нужно для хранения, защиты и проксирования ваших API-ключей и секретов с помощью split-key security.',
    'blog.heroTitle': 'Заметки по безопасности для команд, которые отправляют код с ключами.',
    'login.browserTitle': 'Вход | VaultProof',
    'login.eyebrow': '00 / Безопасный доступ',
    'login.introTitle': 'Войдите в vault. Держите ключи снаружи.',
    'login.authKicker': 'доступ к панели',
    'login.authTitle': 'Войти в VaultProof',
    'login.authSub': 'Управляйте ключами, прокси, сканами и оплатой из одного защищенного рабочего пространства.',
    'login.promoToggle': '+ есть промокод?',
    'login.promoApply': 'применить',
    'login.github': 'продолжить через github',
    'login.google': 'продолжить через google',
    'login.orEmail': 'или по email',
    'login.createAccount': 'создать аккаунт',
    'login.forgotPassword': 'забыли пароль?',
    'login.resetCopy': 'Введите email, и мы отправим ссылку для сброса.',
    'login.sendReset': 'отправить ссылку',
    'login.backToSignIn': 'назад ко входу',
    'login.backLink': '← назад к VaultProof',
    'login.signInAgain': 'Войти снова',
    'dashboard.browserTitle': 'Проекты — VaultProof',
    'dashboard.title': 'Проекты',
    'dashboard.openAlerts': 'оповещения',
    'dashboard.clear': 'чисто',
    'dashboard.needsReview': 'проверить',
    'dashboard.noOpenScannerAlerts': 'Нет открытых оповещений',
    'dashboard.runScan': 'запустите сканирование репозитория',
    'dashboard.scannerHistory': 'история сканера',
    'activity.browserTitle': 'Активность — VaultProof',
    'activity.title': 'Активность',
    'alerts.browserTitle': 'Оповещения — VaultProof',
    'alerts.title': 'Оповещения',
    'settings.browserTitle': 'Настройки — VaultProof',
    'settings.title': 'Настройки',
    'plans.browserTitle': 'Планы — VaultProof',
    'plans.title': 'Планы и биллинг',
    'scanner.browserTitle': 'Сканер — VaultProof',
    'scanner.appTitle': 'Сканер'
  });
  MESSAGES.he = JSON.parse(JSON.stringify(MESSAGES.en));
  Object.assign(MESSAGES.he, {
    'label.language': 'שפה',
    'nav.scanner': 'סורק',
    'nav.docs': 'תיעוד',
    'nav.insights': 'insights',
    'nav.pricing': 'תמחור',
    'nav.signIn': 'התחברות',
    'nav.getStarted': 'להתחיל',
    'nav.support': 'תמיכה',
    'nav.menu': 'תפריט',
    'nav.close': 'סגור',
    'common.loading': 'טוען…',
    'common.live': 'חי',
    'common.refresh': 'רענון',
    'common.exportCsv': 'ייצוא csv',
    'common.currentPlan': 'התוכנית הנוכחית',
    'common.manageBilling': 'ניהול חיוב',
    'app.dashboard': 'דשבורד',
    'app.projects': 'פרויקטים',
    'app.activity': 'פעילות',
    'app.alerts': 'התראות',
    'app.keys': 'מפתחות',
    'app.settings': 'הגדרות',
    'app.plans': 'תוכניות',
    'app.repos': 'מאגרים',
    'app.help': 'עזרה',
    'app.signOut': 'התנתקות',
    'app.planLoading': 'טוען תוכנית',
    'app.allCalls': 'כל הקריאות',
    'app.overview': 'סקירה',
    'app.vault': 'vault',
    'app.scanner': 'סורק',
    'home.title': 'VaultProof | אבטחת מפתחות API לעידן סוכני ה-AI.',
    'home.heroEyebrow': 'בית בטוח יותר למפתחות ה-API שלכם',
    'home.heroTitle': 'הפסיקו לשלוח סודות<br>כטקסט גלוי.',
    'home.heroSub': 'אנחנו מוצאים את המפתחות הפזורים בריפו, מפצלים אותם כך ששום מסד נתונים לא יחזיק מפתח מלא, ומעבירים את קריאות ה-API שלכם דרך proxy בשקט. ה-SDK שלכם לא ירגיש בהבדל.',
    'home.heroLink': 'איך זה עובד →',
    'home.copied': 'הועתק!',
    'scan.title': 'סורק מאגרים ציבורי | VaultProof',
    'scan.eyebrow': '00 / סורק מאגרים ציבורי',
    'scan.heroTitle': 'מצאו מפתחות API חשופים לפני שהם הופכים לאירועי אבטחה.',
    'scan.heroSub': 'הדביקו ריפו ציבורי מ-GitHub ו-VaultProof יבדוק קבצים נוכחיים, היסטוריה אחרונה, קונפיגים מסוכנים והיגיינת אבטחה באותה מערכת מאופקת של הדשבורד הראשי.',
    'scan.kicker': 'חינם / בלי התחברות',
    'scan.cardTitle': 'סריקת מאגר',
    'scan.button': 'סרוק מאגר',
    'docs.browserTitle': 'תיעוד למפתחים | VaultProof',
    'docs.heroTitle': 'תיעוד VaultProof',
    'docs.heroSub': 'כל מה שצריך כדי לשמור, להגן ולהעביר דרך proxy את מפתחות ה-API והסודות שלכם עם split-key security.',
    'blog.browserTitle': 'VaultProof Insights',
    'blog.heroEyebrow': 'VaultProof Insights',
    'blog.heroTitle': 'הערות אבטחה לצוותים שמוציאים קוד עם מפתחות.',
    'blog.heroSub': 'דליפות מפתחות API, אירועי שרשרת אספקה, סיכוני MCP config והערות ארכיטקטורה מעשיות מצוות VaultProof.',
    'blog.latestNote': 'העדכון האחרון: מפתחות חשופים, תהליכי עבודה עם סוכנים, והדרך לצאת מסודות בטקסט גלוי.',
    'login.browserTitle': 'התחברות | VaultProof',
    'login.eyebrow': '00 / גישה מאובטחת',
    'login.introTitle': 'היכנסו ל-vault. השאירו את המפתחות בחוץ.',
    'login.introSub': 'התחברו כדי לנהל פרויקטים עם split-key, proxy לספקים, נעילות מקור ויומני ביקורת מאותה מערכת ששומרת את מפתחות ה-API המלאים מחוץ לאפליקציות שלכם.',
    'login.authKicker': 'גישה לדשבורד',
    'login.authTitle': 'התחברות ל-VaultProof',
    'login.authSub': 'נהלו מפתחות, proxy, סריקות וחיוב מתוך סביבת עבודה אטומה אחת.',
    'login.promoToggle': '+ יש לכם קוד קופון?',
    'login.promoApply': 'החל',
    'login.github': 'המשך עם github',
    'login.google': 'המשך עם google',
    'login.orEmail': 'או אימייל',
    'login.createAccount': 'יצירת חשבון',
    'login.forgotPassword': 'שכחתם סיסמה?',
    'login.resetCopy': 'הזינו את האימייל ונשלח לכם קישור לאיפוס.',
    'login.sendReset': 'שלחו קישור לאיפוס',
    'login.backToSignIn': 'חזרה להתחברות',
    'login.legal': 'בהרשמה אתם מסכימים לתנאים ולמדיניות הפרטיות שלנו.',
    'login.backLink': '← חזרה ל-VaultProof',
    'login.sharesEncrypted': 'חלקים מוצפנים במנוחה',
    'login.sessionExpired': 'פג תוקף הסשן',
    'login.sessionExpiredCopy': 'פג תוקף הסשן שלכם. התחברו שוב כדי להמשיך.',
    'login.signInAgain': 'התחברו שוב',
    'dashboard.browserTitle': 'פרויקטים — VaultProof',
    'dashboard.title': 'פרויקטים',
    'dashboard.keysUnderVault': 'מפתחות ב-vault',
    'dashboard.proxiedCalls': 'קריאות proxy · סה״כ',
    'dashboard.activeProviders': 'ספקים פעילים',
    'dashboard.errorRate': 'שיעור שגיאות',
    'dashboard.proxyCalls30d': 'קריאות proxy · 30 ימים',
    'dashboard.calls': 'קריאות',
    'dashboard.errors': 'שגיאות',
    'dashboard.sort': 'מיון · פעילות אחרונה ↓',
    'dashboard.filter.all': 'הכול',
    'dashboard.filter.production': 'פרודקשן',
    'dashboard.filter.staging': 'סטייג׳ינג',
    'dashboard.filter.development': 'פיתוח',
    'dashboard.filter.idle': 'לא פעיל',
    'dashboard.recentActivity': 'פעילות אחרונה',
    'dashboard.openAlerts': 'התראות פתוחות',
    'dashboard.encryptedAtRest': 'מוצפן במנוחה',
    'dashboard.noRecentActivity': 'אין פעילות אחרונה',
    'dashboard.noProjects': 'אין פרויקטים שתואמים לסינון הזה.',
    'dashboard.clear': 'נקי',
    'dashboard.needsReview': 'דורש בדיקה',
    'dashboard.noOpenScannerAlerts': 'אין התראות סורק פתוחות',
    'dashboard.runScan': 'הריצו סריקת ריפו כדי לראות כאן ממצאים',
    'dashboard.scannerHistory': 'היסטוריית סורק',
    'dashboard.unavailable': 'לא זמין',
    'activity.browserTitle': 'פעילות — VaultProof',
    'activity.title': 'פעילות',
    'alerts.browserTitle': 'התראות — VaultProof',
    'alerts.title': 'התראות',
    'settings.browserTitle': 'הגדרות — VaultProof',
    'settings.title': 'הגדרות',
    'plans.browserTitle': 'תוכניות — VaultProof',
    'plans.title': 'תוכניות וחיוב',
    'scanner.browserTitle': 'סורק — VaultProof',
    'scanner.appTitle': 'סורק'
  });
  MESSAGES.ja = JSON.parse(JSON.stringify(MESSAGES.en));
  Object.assign(MESSAGES.ja, {
    'label.language': '言語',
    'nav.pricing': '料金',
    'nav.signIn': 'サインイン',
    'nav.getStarted': '始める',
    'nav.support': 'サポート',
    'nav.menu': 'メニュー',
    'nav.close': '閉じる',
    'common.loading': '読み込み中…',
    'common.refresh': '更新',
    'common.exportCsv': 'csvを出力',
    'app.dashboard': 'ダッシュボード',
    'app.projects': 'プロジェクト',
    'app.activity': 'アクティビティ',
    'app.alerts': 'アラート',
    'app.keys': 'キー',
    'app.settings': '設定',
    'app.plans': 'プラン',
    'app.repos': 'リポジトリ',
    'app.help': 'ヘルプ',
    'app.signOut': 'サインアウト',
    'app.planLoading': 'プランを読み込み中',
    'app.allCalls': '全コール',
    'home.heroEyebrow': 'APIキーのための、より安全な場所',
    'home.heroTitle': '秘密情報を<br>平文で出荷しない。',
    'scan.heroTitle': '事故になる前に露出したAPIキーを見つける。',
    'login.authTitle': 'VaultProof にサインイン',
    'dashboard.title': 'プロジェクト',
    'dashboard.openAlerts': 'アラート',
    'dashboard.clear': '正常',
    'dashboard.noOpenScannerAlerts': '未対応のアラートはありません',
    'dashboard.runScan': 'リポジトリをスキャンしてください',
    'dashboard.scannerHistory': 'スキャナー履歴',
    'activity.title': 'アクティビティ',
    'alerts.title': 'アラート',
    'settings.title': '設定',
    'plans.title': 'プランと請求',
    'scanner.appTitle': 'スキャナー'
  });
  MESSAGES['zh-CN'] = JSON.parse(JSON.stringify(MESSAGES.en));
  Object.assign(MESSAGES['zh-CN'], {
    'label.language': '语言',
    'nav.pricing': '定价',
    'nav.signIn': '登录',
    'nav.getStarted': '开始使用',
    'nav.support': '支持',
    'nav.menu': '菜单',
    'nav.close': '关闭',
    'common.loading': '加载中…',
    'common.refresh': '刷新',
    'common.exportCsv': '导出 csv',
    'app.dashboard': '控制台',
    'app.projects': '项目',
    'app.activity': '活动',
    'app.alerts': '警报',
    'app.keys': '密钥',
    'app.settings': '设置',
    'app.plans': '套餐',
    'app.repos': '仓库',
    'app.help': '帮助',
    'app.signOut': '退出登录',
    'app.planLoading': '正在加载套餐',
    'app.allCalls': '全部调用',
    'home.heroEyebrow': '给你的 API 密钥一个更安全的家',
    'home.heroTitle': '别再把秘密<br>明文发出去。',
    'scan.heroTitle': '在暴露的 API 密钥变成事故之前先发现它们。',
    'login.authTitle': '登录 VaultProof',
    'dashboard.title': '项目',
    'dashboard.openAlerts': '警报',
    'dashboard.clear': '正常',
    'dashboard.noOpenScannerAlerts': '没有待处理警报',
    'dashboard.runScan': '运行仓库扫描以查看发现',
    'dashboard.scannerHistory': '扫描器历史',
    'activity.title': '活动',
    'alerts.title': '警报',
    'settings.title': '设置',
    'plans.title': '套餐与计费',
    'scanner.appTitle': '扫描器'
  });

  var currentLocale = resolveInitialLocale();
  var renderQueued = false;
  var isRendering = false;

  function resolveInitialLocale() {
    return normalizeLocale(readStoredLocale() || DEFAULT_LOCALE);
  }

  function readStoredLocale() {
    try {
      return window.localStorage && window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function storeLocale(locale) {
    try {
      if (window.localStorage) window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch (_) {}
  }

  function normalizeLocale(input) {
    var locale = String(input || DEFAULT_LOCALE).trim();
    if (!locale) return DEFAULT_LOCALE;
    if (/^es/i.test(locale)) return 'es';
    if (/^fr/i.test(locale)) return 'fr';
    if (/^de/i.test(locale)) return 'de';
    if (/^pt/i.test(locale)) return 'pt-BR';
    if (/^ru/i.test(locale)) return 'ru';
    if (/^(he|iw)/i.test(locale)) return 'he';
    if (/^ja/i.test(locale)) return 'ja';
    if (/^zh/i.test(locale)) return 'zh-CN';
    return 'en';
  }

  function interpolate(template, params) {
    if (!params) return template;
    return String(template).replace(/\{(\w+)\}/g, function (_, key) {
      return params[key] == null ? '' : String(params[key]);
    });
  }

  function t(key, params, fallback) {
    var value =
      (MESSAGES[currentLocale] && MESSAGES[currentLocale][key]) ||
      (MESSAGES.en && MESSAGES.en[key]) ||
      fallback ||
      key;
    return interpolate(value, params);
  }

  function normalizedPath() {
    var path = window.location.pathname || '/';
    if (path !== '/' && /\/$/.test(path)) path = path.slice(0, -1);
    return path || '/';
  }

  function setText(selector, key, options) {
    var config = options || {};
    var elements = typeof selector === 'string' ? document.querySelectorAll(selector) : selector;
    if (!elements) return;
    Array.prototype.forEach.call(elements, function (element) {
      if (!element) return;
      var value = t(key, config.params, config.fallback);
      if (config.attr) element.setAttribute(config.attr, value);
      else if (config.html) element.innerHTML = value;
      else element.textContent = value;
    });
  }

  function setButtonLabel(selector, key) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function (button) {
      if (!button) return;
      var label = t(key);
      var icon = button.querySelector('svg');
      if (!icon) {
        button.textContent = label;
        return;
      }
      while (button.lastChild && button.lastChild !== icon) {
        button.removeChild(button.lastChild);
      }
      button.appendChild(document.createTextNode(' ' + label));
    });
  }

  function applyKnownAnchorTranslations(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('a[href]'), function (link) {
      if (link.hasAttribute('data-i18n-lock') || link.closest('[data-i18n-lock]')) return;
      var href = link.getAttribute('href') || '';
      var path = href.split('#')[0];
      var text = (link.textContent || '').trim().toLowerCase();
      if (path === '/scan') link.textContent = t('nav.scanner');
      else if (path === '/docs') link.textContent = t('nav.docs');
      else if (path === '/blog') link.textContent = t('nav.insights');
      else if (href.indexOf('#pricing') !== -1) link.textContent = t('nav.pricing');
      else if (href === '/app/login') {
        if (link.classList.contains('nav-cta') || text.indexOf('get started') !== -1 || text.indexOf('start') === 0) link.textContent = t('nav.getStarted');
        else if (link.classList.contains('nav-sign-in') || text.indexOf('sign in') !== -1 || text.indexOf('login') !== -1) link.textContent = t('nav.signIn');
      } else if (path === '/app' || path === '/app/') link.textContent = t('app.dashboard');
      else if (path === '/app/activity') link.textContent = t('app.activity');
      else if (path === '/app/alerts') link.textContent = t('app.alerts');
      else if (path === '/app/keys') link.textContent = t('app.keys');
      else if (path === '/app/settings') link.textContent = t('app.settings');
      else if (path === '/app/plans') link.textContent = t('app.plans');
      else if (path === '/app/scanner') link.textContent = t('app.repos');
      else if (href.indexOf('mailto:hello@vaultproof.dev') === 0) link.textContent = t('nav.support');
    });
  }

  function updateMenuToggle() {
    var toggle = document.getElementById('mobileToggle');
    var menu = document.getElementById('mobileMenu');
    if (!toggle) return;
    var open = menu && menu.classList.contains('open');
    toggle.textContent = open ? t('nav.close') : t('nav.menu');
    toggle.setAttribute('aria-label', open ? t('nav.close') : t('nav.menu'));
  }

  function ensureLanguageControl() {
    if (!document.body || document.getElementById('vpLanguageControl')) return;
    if (!document.getElementById('vpLanguageControlStyles')) {
      var style = document.createElement('style');
      style.id = 'vpLanguageControlStyles';
      style.textContent = [
        '.vp-language-control{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(0,229,255,.28);background:rgba(5,9,12,.72);box-shadow:0 18px 46px rgba(0,0,0,.24);backdrop-filter:blur(16px);font:500 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:rgba(247,251,255,.82)}',
        '.vp-language-control select{border:0;background:transparent;color:inherit;font:inherit;outline:0;cursor:pointer;max-width:140px}',
        '.vp-language-control select option{background:#05090c;color:#f7fbff}',
        '.vp-language-control.is-busy::after{content:"";width:8px;height:8px;border-radius:999px;background:#00e5ff;animation:vpLangPulse .8s ease-in-out infinite alternate}',
        '@keyframes vpLangPulse{from{opacity:.35}to{opacity:1}}',
        '@media (max-width:640px){.vp-language-control{right:10px;bottom:10px;max-width:calc(100vw - 20px)}}',
        '@media print{.vp-language-control{display:none!important}}'
      ].join('');
      document.head.appendChild(style);
    }

    var wrap = document.createElement('div');
    wrap.id = 'vpLanguageControl';
    wrap.className = 'vp-language-control';
    wrap.setAttribute('data-vp-no-translate', 'true');

    var select = document.createElement('select');
    select.id = 'vpLanguageSelect';
    select.setAttribute('aria-label', t('label.language', null, 'Language'));
    SUPPORTED_LOCALES.forEach(function (locale) {
      var option = document.createElement('option');
      option.value = locale;
      option.textContent = LOCALE_LABELS[locale] || locale;
      select.appendChild(option);
    });
    select.value = currentLocale;
    select.addEventListener('change', function () {
      setLocale(select.value);
    });

    wrap.appendChild(select);
    document.body.appendChild(wrap);
  }

  function updateLanguageControl() {
    var select = document.getElementById('vpLanguageSelect');
    if (!select) return;
    select.value = currentLocale;
    select.setAttribute('aria-label', t('label.language', null, 'Language'));
  }

  function applyPathTranslations() {
    var path = normalizedPath();
    var pageMap = {
      '/': function () {
        document.title = t('home.title');
        setText('.hero-eyebrow', 'home.heroEyebrow');
        setText('.hero-h1', 'home.heroTitle', { html: true });
        setText('.hero-sub', 'home.heroSub');
        setText('.hero-cta-link a', 'home.heroLink');
        setText('.hero-cta-cmd-hint', 'home.copyHint');
      },
      '/scan': function () {
        document.title = t('scan.title');
        setText('.scan-hero .eyebrow', 'scan.eyebrow');
        setText('.scan-title', 'scan.heroTitle');
        setText('.scan-subtitle', 'scan.heroSub');
        setText('.proof-item:nth-child(1) .proof-title', 'scan.proofSecrets');
        setText('.proof-item:nth-child(1) .proof-copy', 'scan.proofSecretsCopy');
        setText('.proof-item:nth-child(2) .proof-title', 'scan.proofHistory');
        setText('.proof-item:nth-child(2) .proof-copy', 'scan.proofHistoryCopy');
        setText('.proof-item:nth-child(3) .proof-title', 'scan.proofHygiene');
        setText('.proof-item:nth-child(3) .proof-copy', 'scan.proofHygieneCopy');
        setText('.scanner-kicker', 'scan.kicker');
        setText('.scanner-title', 'scan.cardTitle');
        setButtonLabel('.scan-button', 'scan.button');
        setText('.scan-limits', 'scan.limits');
        setText('#whatWeScan .section-label', 'scan.sectionLabel');
        setText('#whatWeScan .section-h2', 'scan.sectionTitle');
        var repoInput = document.getElementById('repoInput');
        if (repoInput) repoInput.placeholder = 'github.com/owner/repo or owner/repo';
      },
      '/docs': function () {
        document.title = t('docs.browserTitle');
        setText('#overview h1', 'docs.heroTitle');
        setText('#overview > p', 'docs.heroSub');
      },
      '/blog': function () {
        document.title = t('blog.browserTitle');
        setText('.hero-eyebrow', 'blog.heroEyebrow');
        setText('.hero-h1', 'blog.heroTitle');
        setText('.hero-sub', 'blog.heroSub');
        setText('.hero-note p', 'blog.latestNote');
        setText('.section-label', 'blog.sectionLabel');
        setText('.section-h2', 'blog.sectionTitle');
        setText('.section-sub', 'blog.sectionSub');
      },
      '/app/login': function () {
        document.title = t('login.browserTitle');
        setText('.eyebrow', 'login.eyebrow');
        setText('.intro-h1', 'login.introTitle');
        setText('.intro-sub', 'login.introSub');
        setText('.auth-kicker', 'login.authKicker');
        setText('.auth-title', 'login.authTitle');
        setText('.auth-subtitle', 'login.authSub');
        setText('#promoToggleBtn', 'login.promoToggle');
        setText('#promoApplyBtn', 'login.promoApply');
        setButtonLabel('#loginWithGitHubBtn', 'login.github');
        setButtonLabel('#loginWithGoogleBtn', 'login.google');
        setText('.divider', 'login.orEmail');
        setText('#loginTab', 'nav.signIn');
        setText('#registerTab', 'login.createAccount');
        setText('#showResetBtn', 'login.forgotPassword');
        setText('#loginBtn', 'nav.signIn');
        setText('.reset-copy', 'login.resetCopy');
        setText('#resetBtn', 'login.sendReset');
        setText('#backToSigninBtn', 'login.backToSignIn');
        setText('#regBtn', 'login.createAccount');
        setText('.back-link a', 'login.backLink');
        setText('#loginEmail, #resetEmail, #regEmail', 'login.placeholder.email', { attr: 'placeholder' });
        setText('#loginPassword', 'login.placeholder.password', { attr: 'placeholder' });
        setText('#promoCodeInput', 'login.placeholder.code', { attr: 'placeholder' });
        setText('#regPassword', 'login.placeholder.minChars', { attr: 'placeholder' });
        setText('#sessionExpired h3', 'login.sessionExpired');
        setText('#sessionExpired p', 'login.sessionExpiredCopy');
        setText('#sessionExpired a', 'login.signInAgain');
      },
      '/app': function () {
        document.title = t('dashboard.browserTitle');
        setText('.page-title', 'dashboard.title');
        setText('#openAlertsLabel', 'dashboard.openAlerts');
        setText('.kpi-cell:nth-child(1) .kpi-label', 'dashboard.keysUnderVault');
        setText('.kpi-cell:nth-child(2) .kpi-label', 'dashboard.proxiedCalls');
        setText('.kpi-cell:nth-child(3) .kpi-label', 'dashboard.activeProviders');
        setText('.kpi-cell:nth-child(4) .kpi-label', 'dashboard.errorRate');
        setText('#usagePlanLabel', 'app.planLoading');
        setText('#usageMetricLabel', 'app.allCalls');
        setText('.filter-chip[data-filter="all"]', 'dashboard.filter.all');
        setText('.filter-chip[data-filter="production"]', 'dashboard.filter.production');
        setText('.filter-chip[data-filter="staging"]', 'dashboard.filter.staging');
        setText('.filter-chip[data-filter="development"]', 'dashboard.filter.development');
        setText('.filter-chip[data-filter="idle"]', 'dashboard.filter.idle');
        setText('.filter-sort', 'dashboard.sort');
      },
      '/app/activity': function () {
        document.title = t('activity.browserTitle');
        setText('.page-title', 'activity.title');
        setText('.page-desc', 'activity.desc');
        setText('#refreshBtn', 'common.refresh');
        setText('#exportBtn', 'common.exportCsv');
        setText('#usagePlanLabel', 'app.planLoading');
        setText('#usageMetricLabel', 'app.allCalls');
        setText('#chartNote', 'activity.chartNote');
      },
      '/app/alerts': function () {
        document.title = t('alerts.browserTitle');
        setText('.page-title', 'alerts.title');
        setText('.page-desc', 'alerts.desc');
        setText('#refreshBtn', 'common.refresh');
        setText('#exportBtn', 'common.exportCsv');
        setText('#usagePlanLabel', 'app.planLoading');
        setText('#usageMetricLabel', 'app.allCalls');
        setText('#chartNote', 'alerts.chartNote');
        setText('#searchInput', 'alerts.search', { attr: 'placeholder' });
      },
      '/app/keys': function () {
        document.title = t('keys.browserTitle');
        setText('.page-title', 'keys.title');
        setText('.page-desc', 'keys.desc');
      },
      '/app/settings': function () {
        document.title = t('settings.browserTitle');
        setText('main h1', 'settings.title');
        setText('main h1 + p', 'settings.subtitle');
      },
      '/app/plans': function () {
        document.title = t('plans.browserTitle');
        setText('main h1', 'plans.title');
        setText('main h1 + p', 'plans.subtitle');
      },
      '/app/scanner': function () {
        document.title = t('scanner.browserTitle');
        setText('header h1', 'scanner.appTitle');
        setText('header p', 'scanner.appSubtitle');
        setText('#stateNotConnected h2', 'scanner.connectedTitle');
      }
    };
    if (pageMap[path]) pageMap[path]();
  }

  function applySharedChrome() {
    document.documentElement.lang = currentLocale;
    document.documentElement.dir = currentLocale === 'he' ? 'rtl' : 'ltr';
    if (document.body) {
      document.body.classList.toggle('vp-rtl', currentLocale === 'he');
    }
    applyKnownAnchorTranslations(document);
    updateMenuToggle();
    setText('.topbar-signout', 'app.signOut');
    setText('#logoutBtn', 'app.signOut');
    setSidebarLabels();
    setDashboardMetaText();
    setPlansButtons();
    updateLanguageControl();
  }

  function setSidebarLabels() {
    Array.prototype.forEach.call(document.querySelectorAll('.sidebar-head'), function (node) {
      if (node.closest('[data-i18n-lock]')) return;
      var text = (node.textContent || '').trim().toLowerCase();
      if (text === 'overview') node.textContent = t('app.overview');
      else if (text === 'vault') node.textContent = t('app.vault');
      else if (text === 'scanner') node.textContent = t('app.scanner');
      else if (text === 'help') node.textContent = t('app.help');
    });
  }

  function setDashboardMetaText() {
    replaceExactText('#usagePlanLabel', { 'plan loading': t('app.planLoading') });
    replaceExactText('#usageMetricLabel', { 'all calls': t('app.allCalls') });
    replaceExactText('#usageMetricNote', { 'loading…': t('common.loading') });
    replaceExactText('#alertsStatus', {
      loading: t('common.loading'),
      'loading…': t('common.loading'),
      clear: t('dashboard.clear'),
      unavailable: t('dashboard.unavailable'),
      'needs review': t('dashboard.needsReview')
    });
    replaceExactText('#activity-feed .activity-row span:last-child', { 'no recent activity': t('dashboard.noRecentActivity') });
    replaceExactText('.alert-title', {
      'Loading alerts…': t('alerts.loading'),
      'No open scanner alerts': t('dashboard.noOpenScannerAlerts')
    });
    replaceExactText('.alert-meta', {
      'scanner history': t('dashboard.scannerHistory'),
      'run a repo scan to surface findings here': t('dashboard.runScan')
    });
    replaceExactText('#kpi-keys-sub', { 'encrypted at rest': t('dashboard.encryptedAtRest'), unavailable: t('dashboard.unavailable') });
    replaceExactText('#kpi-calls-sub, #kpi-providers-sub, #kpi-errors-sub', { unavailable: t('dashboard.unavailable') });
    replaceExactText('#pageMeta', {
      '/ loading…': '/ ' + t('common.loading'),
      '/ activity unavailable': '/ ' + t('activity.dataUnavailable'),
      '/ alerts unavailable': '/ ' + t('alerts.unavailable')
    });
    replaceExactText('#queueStatus, #streamStatus', { 'loading…': t('common.loading') });
    replaceExactText('#filterNote', {
      'loading activity…': t('activity.loading'),
      'could not load activity': t('activity.couldNotLoad'),
      'loading alerts…': t('alerts.loading'),
      'could not load alerts': t('alerts.couldNotLoad')
    });
    replaceExactText('.empty-state', {
      'Loading endpoints…': t('common.loading'),
      'Loading errors…': t('common.loading'),
      'No endpoint activity yet.': t('activity.noEndpoints')
    });
    replaceExactText('#currentPlanBadge', { 'Loading...': t('common.loading') });
  }

  function setPlansButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('.billing-upgrade-btn[data-tier]'), function (button) {
      if (!button) return;
      var tier = button.getAttribute('data-tier') || '';
      button.textContent = t('plans.upgradeTo', { tier: tier.charAt(0).toUpperCase() + tier.slice(1) }, 'Upgrade to ' + tier);
    });
    replaceExactText('#freeBtn', { 'Current Plan': t('common.currentPlan') });
    replaceExactText('#manageBtn button', { 'Manage Billing': t('common.manageBilling') });
  }

  function replaceExactText(selector, map) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function (node) {
      if (!node) return;
      var value = (node.textContent || '').trim();
      if (map[value] != null) node.textContent = map[value];
    });
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(function () {
      renderQueued = false;
      render();
    });
  }

  function render() {
    isRendering = true;
    applySharedChrome();
    applyPathTranslations();
    isRendering = false;
    queueMachineTranslation();
  }

  function setLocale(locale) {
    var next = normalizeLocale(locale);
    if (SUPPORTED_LOCALES.indexOf(next) === -1) next = DEFAULT_LOCALE;
    restoreMachineTranslations();
    currentLocale = next;
    storeLocale(currentLocale);
    render();
    window.dispatchEvent(new CustomEvent('vp:localechange', { detail: { locale: currentLocale } }));
  }

  var observer = new MutationObserver(function () {
    if (isRendering || isApplyingMachineTranslation || suppressMachineTranslationObserver) return;
    queueRender();
  });

  function canUseMachineTranslation(locale) {
    return locale !== DEFAULT_LOCALE && Boolean(DEEPL_TARGET_LOCALES[locale]);
  }

  function setLanguageControlBusy(isBusy) {
    var control = document.getElementById('vpLanguageControl');
    if (control) control.classList.toggle('is-busy', Boolean(isBusy));
  }

  function restoreMachineTranslations() {
    translationGeneration += 1;
    if (!translatedNodes.length) return;
    isApplyingMachineTranslation = true;
    suppressMachineTranslationObserver = true;
    try {
      translatedNodes.forEach(function (node) {
        if (node && originalTextByNode.has(node)) node.nodeValue = originalTextByNode.get(node);
      });
    } finally {
      translatedNodes = [];
      translatedNodeSet = new WeakSet();
      isApplyingMachineTranslation = false;
      window.setTimeout(function () { suppressMachineTranslationObserver = false; }, 0);
    }
  }

  function queueMachineTranslation() {
    if (!canUseMachineTranslation(currentLocale) || machineTranslationQueued) return;
    machineTranslationQueued = true;
    var locale = currentLocale;
    var generation = translationGeneration;
    window.setTimeout(function () {
      machineTranslationQueued = false;
      applyMachineTranslation(locale, generation);
    }, 220);
  }

  function shouldSkipTranslationParent(parent) {
    if (!parent || parent.nodeType !== 1) return true;
    return Boolean(parent.closest('script,style,noscript,code,pre,kbd,samp,textarea,select,option,svg,canvas,[data-vp-no-translate]'));
  }

  function shouldTranslateText(text) {
    var value = String(text || '').trim();
    if (value.length < 2 || value.length > 1800) return false;
    if (!/[A-Za-z\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\u3400-\u9FFF]/.test(value)) return false;
    if (/^(https?:\/\/|mailto:|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i.test(value)) return false;
    if (/^(vp-|sk-|pk_|ghp_|glpat-|xoxb-|AIza|SG\.)/i.test(value)) return false;
    if (/^[\d\s.,:;+\-/()[\]{}#_*|<>=$%]+$/.test(value)) return false;
    return true;
  }

  function collectTranslatableTextNodes() {
    var nodes = [];
    if (!document.body || typeof document.createTreeWalker !== 'function') return nodes;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;
        if (translatedNodeSet.has(node)) return NodeFilter.FILTER_REJECT;
        if (shouldSkipTranslationParent(node.parentElement)) return NodeFilter.FILTER_REJECT;
        return shouldTranslateText(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode() && nodes.length < MAX_TRANSLATION_NODES) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function splitWhitespace(value) {
    var raw = String(value || '');
    var leading = (raw.match(/^\s*/) || [''])[0];
    var trailing = (raw.match(/\s*$/) || [''])[0];
    return {
      leading: leading,
      text: raw.trim(),
      trailing: trailing
    };
  }

  function cacheForLocale(locale) {
    if (!translationCache[locale]) translationCache[locale] = {};
    return translationCache[locale];
  }

  function applyTranslatedNode(node, translated) {
    if (!node || !translated) return;
    if (!originalTextByNode.has(node)) originalTextByNode.set(node, node.nodeValue || '');
    var parts = splitWhitespace(node.nodeValue);
    isApplyingMachineTranslation = true;
    suppressMachineTranslationObserver = true;
    try {
      node.nodeValue = parts.leading + translated + parts.trailing;
      translatedNodeSet.add(node);
      translatedNodes.push(node);
    } finally {
      isApplyingMachineTranslation = false;
      window.setTimeout(function () { suppressMachineTranslationObserver = false; }, 0);
    }
  }

  function translationBatches(texts) {
    var batches = [];
    var batch = [];
    var chars = 0;
    texts.forEach(function (text) {
      var nextChars = chars + text.length;
      if (batch.length >= MAX_TRANSLATION_BATCH || (batch.length && nextChars > MAX_TRANSLATION_CHARS)) {
        batches.push(batch);
        batch = [];
        chars = 0;
      }
      batch.push(text);
      chars += text.length;
    });
    if (batch.length) batches.push(batch);
    return batches;
  }

  async function translateBatch(locale, texts) {
    var response = await fetch(TRANSLATE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLang: locale, texts: texts })
    });
    if (!response.ok) throw new Error('translation failed');
    var data = await response.json();
    return Array.isArray(data.translations) ? data.translations : [];
  }

  async function applyMachineTranslation(locale, generation) {
    if (locale !== currentLocale || generation !== translationGeneration || !canUseMachineTranslation(locale)) return;
    var nodes = collectTranslatableTextNodes();
    if (!nodes.length) return;

    var cache = cacheForLocale(locale);
    var pending = [];
    var seen = {};
    nodes.forEach(function (node) {
      var source = splitWhitespace(node.nodeValue).text;
      if (!source) return;
      if (cache[source]) {
        applyTranslatedNode(node, cache[source]);
      } else if (!seen[source]) {
        seen[source] = true;
        pending.push(source);
      }
    });

    if (!pending.length) return;
    setLanguageControlBusy(true);
    try {
      var batches = translationBatches(pending);
      for (var i = 0; i < batches.length; i++) {
        if (locale !== currentLocale || generation !== translationGeneration) return;
        var batch = batches[i];
        var translated = await translateBatch(locale, batch);
        batch.forEach(function (source, index) {
          if (translated[index]) cache[source] = translated[index];
        });
      }
      if (locale !== currentLocale || generation !== translationGeneration) return;
      collectTranslatableTextNodes().forEach(function (node) {
        var source = splitWhitespace(node.nodeValue).text;
        if (cache[source]) applyTranslatedNode(node, cache[source]);
      });
    } catch (_) {
      // Translation is a progressive enhancement; keep the English page usable.
    } finally {
      setLanguageControlBusy(false);
    }
  }

  function init() {
    ensureLanguageControl();
    render();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    document.addEventListener('click', function (event) {
      if (event.target && event.target.closest('#mobileToggle')) {
        window.setTimeout(queueRender, 0);
      }
    });
  }

  window.VP_I18N = {
    ready: true,
    t: t,
    getLocale: function () { return currentLocale; },
    setLocale: setLocale,
    locales: SUPPORTED_LOCALES.slice(),
    labels: Object.assign({}, LOCALE_LABELS)
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
