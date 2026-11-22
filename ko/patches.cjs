// Changes to structs-webapp's sources that are not translation, as
// [upstream text, replacement] pairs per upstream file.
//
// structs-webapp is served by its guild and reaches the guild API at /api,
// with a session cookie, and GRASS and the chain node on the same host. This
// page hosts none of them: these patches send webapp to 우주상사's (0-12)
// services, as ko/runtime/guild.js reads them, with a bearer token instead
// of the cookie.
module.exports = {
  'js/index.js': [
    // Nothing below may run before the guild, and so its services, is known.
    // The tutorial is a simulation and needs no guild.
    ['const tutorialMode = TutorialMode.isActive();', 'if (!TutorialMode.isActive()) await __ko.guild.ready;\nconst tutorialMode = TutorialMode.isActive();'],
    ['`ws://${window.location.hostname}:1443`', '(__ko.guild.grass || `ws://${window.location.hostname}:1443`)'],
  ],
  'js/managers/SigningClientManager.js': [
    [': `ws://${window.location.hostname}:26657`)', ': (__ko.guild.chainWs || `ws://${window.location.hostname}:26657`))'],
  ],
  'js/api/GuildAPI.js': [
    ["this.apiUrl = '/api';", "Object.defineProperty(this, 'apiUrl', {get: () => __ko.guild.api, enumerable: true});"],
    // This page's guild is fixed (0-12), never looked up: /guild/this is the
    // API host's own guild, and 우주상사 shares SN Corp's API.
    ['`${this.apiUrl}/guild/this`', '`${this.apiUrl}/guild/${__ko.guild.id}`'],
    // /auth/token takes the same signed login as /auth/login and answers with a bearer token.
    [
      'const jsonResponse = await this.ajax.post(`${this.apiUrl}/auth/login`, loginRequestDTO, {...options, reauthenticate: false});',
      'const jsonResponse = await this.ajax.post(`${this.apiUrl}/auth/token`, loginRequestDTO, {...options, reauthenticate: false});\n'
      + '    __ko.guild.setToken(jsonResponse?.success ? jsonResponse.data?.access_token : null);',
    ],
    [
      'const jsonResponse = await this.ajax.post(`${this.apiUrl}/auth/logout`, {}, options);',
      'const jsonResponse = await this.ajax.post(`${this.apiUrl}/auth/logout`, {}, options);\n    __ko.guild.setToken(null);',
    ],
  ],
  // Sector Blitz contests are read from the same guild's /api/influence.
  'js/api/InfluenceAPI.js': [
    ["this.apiUrl = '/api/influence';", "Object.defineProperty(this, 'apiUrl', {get: () => `${__ko.guild.api}/influence`, enumerable: true});"],
  ],
  // The public leaderboard and spectating read the guild's public API, with
  // nobody signed in. The leaderboard page asks before the guild is known.
  'js/api/PublicSectorBlitzAPI.js': [
    ["this.apiUrl = '/api/public/sector-blitz';", "Object.defineProperty(this, 'apiUrl', {get: () => `${__ko.guild.api}/public/sector-blitz`, enumerable: true});"],
    ['    const response = await fetch(', '    await __ko.guild.ready;\n    const response = await fetch('],
  ],
  'js/framework/JsonAjaxer.js': [
    ["headers: {\n        'Content-Type': 'application/json'\n      },", "headers: {\n        'Content-Type': 'application/json',\n        ...__ko.guild.headers()\n      },"],
  ],
  'js/managers/AuthManager.js': [
    // Before any guild API call, recovery checks on chain that the player is in
    // this guild, moving them here from another guild, and stops if they are
    // not: a shared guild API may log in another guild's player (recovery.js).
    [
      'import {MenuPage} from "../framework/MenuPage";',
      'import {MenuPage} from "../framework/MenuPage";\nimport {MenuWaitingViewModel} from "../view_models/generic/MenuWaitingViewModel";',
    ],
    [
      'const primaryAddress = this.gameState.signingAccount.address;\n    const guildId = this.gameState.thisGuild.id;',
      'const primaryAddress = this.gameState.signingAccount.address;\n'
      + '    if (!await __ko.recovery.ensureInThisGuild(this, primaryAddress, signal, MenuWaitingViewModel.setMessage)) return false;\n'
      + '    const guildId = this.gameState.thisGuild.id;',
    ],
  ],
  // No recovery key section in sign-up (runtime/account.js): once the player
  // has chosen their name the key is made and the account created, with
  // nothing shown, explained or confirmed, and sign-up goes on to Success
  // (whose text no longer mentions the key: strings/.../SignupSuccessViewModel).
  'js/controllers/AuthController.js': [
    [
      '  signupRecoveryKeyIntro() {\n    const viewModel = new RecoveryKeyIntroViewModel();\n    viewModel.render();\n  }',
      '  signupRecoveryKeyIntro() {\n    __ko.account.createAccount(this, MenuPage);\n  }',
    ],
  ],
  // The Account page: Download Player (a file holding the mnemonic) in place
  // of Log Out.
  'js/view_models/account/AccountIndexViewModel.js': [
    ['<button id="${this.logoutBtnId}" class="sui-screen-btn sui-mod-destructive">Log Out</button>',
      '${__ko.account.downloadButtonHTML(this)}'],
    [
      "    document.getElementById(this.logoutBtnId).addEventListener('click', () => {\n      MenuPage.router.goto('Account', 'logoutConfirm');\n    });\n",
      "    __ko.account.bindDownload(this);\n",
    ],
  ],
  'js/telemetry/OnboardingTelemetry.js': [
    // Guilds accept only ASCII here (RegexPattern::SLUG): 구조체, romanized.
    ["ONBOARDING_INTERFACE_NAME = 'structs-webapp'", "ONBOARDING_INTERFACE_NAME = 'gujoche'"],
    ['fetch(ENDPOINT, {', 'fetch(`${__ko.guild.api}/onboarding/events`, {'],
    ['navigator.sendBeacon(ENDPOINT, body)', 'navigator.sendBeacon(`${__ko.guild.api}/onboarding/events`, body)'],
  ],
  // Display text of struct types arrives in English; type and category stay
  // as they are, since webapp's code compares them.
  'js/factories/StructTypeFactory.js': [
    ['    return structType;', `    __ko.fields(structType, [
      'class', 'class_abbreviation', 'unit_description',
      'primary_weapon_label', 'primary_weapon_description', 'primary_weapon_class',
      'secondary_weapon_label', 'secondary_weapon_description', 'secondary_weapon_class',
      'drive_label', 'drive_description', 'passive_weaponry_label', 'passive_weaponry_description',
      'unit_defenses_label', 'unit_defenses_description', 'ore_reserve_defenses_label',
      'ore_reserve_defenses_description', 'planetary_defenses_label', 'planetary_defenses_description',
    ]);
    return structType;`],
  ],
};
