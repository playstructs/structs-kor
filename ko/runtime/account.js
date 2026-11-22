// The player's key, kept out of sight.
//
// webapp's sign-up shows the new player their recovery key (the mnemonic of
// their account's key), explains it, and asks them to type it back before it
// creates the account. Here that whole section is skipped: once the player has
// chosen their name, the key is made and the account created straight away
// (createAccount, patched into AuthController.signupRecoveryKeyIntro), and the
// player goes on to the success screen.
//
// Instead of Log Out, the Account page offers Download Player: a text file
// holding the mnemonic this browser signs with (downloadButtonHTML,
// bindDownload). After sign-up that is the account's own key; after a
// recovery or a device activation it is this browser's device key, which can
// recover the player too.
//
// After cgi-bad-kids' bk/runtime/account.js, in Korean.
import {PageHeader} from '../../structs-webapp/src/js/view_models/templates/partials/PageHeader.js';

const STATUS_ID = 'ko-signup-status';
const ERROR_ID = 'ko-signup-error';
const RETRY_ID = 'ko-signup-retry-btn';
const DOWNLOAD_ID = 'account-menu-download-player-btn';

let inFlight = false;

/**
 * Creates the player's account without showing them its key.
 *
 * @param {object} controller webapp's AuthController
 * @param {object} menuPage webapp's MenuPage
 */
function createAccount(controller, menuPage) {
  const {gameState, authManager, walletManager} = controller;
  if (gameState.mnemonic === null) {
    gameState.mnemonic = walletManager.createMnemonic();
  }

  const pageHeader = new PageHeader();
  pageHeader.pageLabel = '계정 만들기';
  menuPage.hideAndClearNav();
  menuPage.setBodyContent(`
    <div class="full-screen-content-container">
      ${pageHeader.render()}
      <div class="common-layout-col">
        <div class="common-group-col">
          <div id="${STATUS_ID}">계정을 만드는 중입니다…</div>
          <img src="/img/loading-3-dots.gif" class="loading-3-dots" alt="">
        </div>
        <div class="common-inline-text-input-error-container">
          <div id="${ERROR_ID}" class="sui-input-text-warning" role="alert">
            가입을 완료하지 못했습니다. 길드가 잠시 응답하지 않는 것 같습니다. 조금 뒤에 다시 시도해 주세요.
          </div>
        </div>
        <div>
          <button id="${RETRY_ID}" class="sui-screen-btn sui-mod-primary hidden" type="button">다시 시도</button>
        </div>
      </div>
    </div>
  `);
  menuPage.hideAndClearDialoguePanel();

  const status = document.getElementById(STATUS_ID);
  const dots = status.nextElementSibling;
  const error = document.getElementById(ERROR_ID);
  const retry = document.getElementById(RETRY_ID);

  const failed = reason => {
    if (reason) console.error('[ko] signup request failed:', reason);
    inFlight = false;
    status.textContent = '계정을 만들지 못했습니다.';
    dots.classList.add('hidden');
    error.classList.add('sui-mod-show');
    retry.classList.remove('hidden');
  };

  const submit = () => {
    if (inFlight) return;
    inFlight = true;
    status.textContent = '계정을 만드는 중입니다…';
    dots.classList.remove('hidden');
    error.classList.remove('sui-mod-show');
    retry.classList.add('hidden');
    // As webapp's recovery key confirmation does, once the key is confirmed.
    authManager.signup(gameState.mnemonic).then(success => {
      if (!success) return failed(null);
      inFlight = false;
      gameState.save();
      menuPage.router.goto('Auth', 'signupSuccess');
    }).catch(failed);
  };

  retry.addEventListener('click', submit);
  submit();
}

/**
 * Download Player, where the Account page had Log Out.
 *
 * @param {object} viewModel AccountIndexViewModel
 * @return {string}
 */
function downloadButtonHTML(viewModel) {
  const ready = typeof viewModel.gameState.mnemonic === 'string' && viewModel.gameState.mnemonic !== '';
  return `<button id="${DOWNLOAD_ID}" class="sui-screen-btn sui-mod-secondary${ready ? '' : ' sui-mod-disabled'}" type="button"${ready ? '' : ' disabled'}>플레이어 다운로드</button>`;
}

/**
 * Saves a text file holding the mnemonic this browser signs with.
 *
 * @param {object} viewModel AccountIndexViewModel
 */
function bindDownload(viewModel) {
  document.getElementById(DOWNLOAD_ID)?.addEventListener('click', () => {
    const mnemonic = viewModel.gameState.mnemonic;
    if (typeof mnemonic !== 'string' || !mnemonic) return;
    const player = viewModel.gameState.keyPlayers?.player;
    // Korean names stay in the file name; anything else a file name can't hold is _.
    const name = String(player?.getUsername?.() || 'player').replace(/[^\p{L}\p{N}_-]+/gu, '_');
    const id = String(player?.id || '').replace(/[^\w-]+/g, '_');
    const url = URL.createObjectURL(new Blob([`${mnemonic}\n`], {type: 'text/plain'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}${id ? `-${id}` : ''}.structs-player.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

export const account = Object.freeze({createAccount, downloadButtonHTML, bindDownload});
