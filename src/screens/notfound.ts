import type { Screen } from '../router';
import { href } from '../router';
import { html, mount } from '../ui/dom';

const screen: Screen = {
  render(root) {
    mount(root, html`<section class="card" style="max-width:520px;margin:60px auto;text-align:center;align-items:center">
      <span class="label faint">404 · 좌표 없음</span><h1 style="font-size:40px">이 좌표에는 아무것도 없습니다</h1>
      <a class="btn primary" href="${href('/')}">홈으로</a></section>`);
  },
};
export default screen;
