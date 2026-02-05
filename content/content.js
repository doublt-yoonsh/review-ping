// ReviewPing - Content Script
// GitHub PR 페이지에서 PR 정보를 추출하고 버튼을 삽입

(function() {
  'use strict';

  // 이미 초기화되었는지 확인
  if (window.reviewPingInitialized) {
    return;
  }
  window.reviewPingInitialized = true;

  // 머지 알림 전송 여부 추적 (PR URL 기준) - storage에서 로드
  let notifiedMerges = new Set();

  // storage에서 notifiedMerges 로드
  chrome.storage.local.get({ notifiedMerges: [] }, (result) => {
    notifiedMerges = new Set(result.notifiedMerges);
  });

  // 리뷰어 히스토리 저장 (저장소별)
  function saveReviewerHistory(owner, repo, reviewers) {
    if (!reviewers || reviewers.length === 0) return;

    const repoKey = `${owner}/${repo}`.toLowerCase();

    chrome.storage.local.get({ reviewerHistory: {} }, (result) => {
      const history = result.reviewerHistory;
      const existing = new Set(history[repoKey] || []);

      // 새 리뷰어 추가
      reviewers.forEach(r => existing.add(r));

      // 최대 20명까지만 저장 (최근 사용 순으로)
      const updated = [...existing].slice(-20);
      history[repoKey] = updated;

      chrome.storage.local.set({ reviewerHistory: history });
      console.log('[ReviewPing] Saved reviewer history for', repoKey, ':', updated);
    });
  }

  // 리뷰어 히스토리 불러오기 (저장소별)
  async function getReviewerHistory(owner, repo) {
    return new Promise((resolve) => {
      const repoKey = `${owner}/${repo}`.toLowerCase();

      chrome.storage.local.get({ reviewerHistory: {} }, (result) => {
        const history = result.reviewerHistory;
        const reviewers = history[repoKey] || [];
        resolve(reviewers);
      });
    });
  }

  // ========== 세션 기반 GitHub 리뷰어 추가 ==========

  // CSRF 토큰 추출
  function getCSRFToken() {
    // meta 태그에서 추출
    const metaToken = document.querySelector('meta[name="csrf-token"]');
    if (metaToken) {
      return metaToken.getAttribute('content');
    }

    // form의 hidden input에서 추출
    const inputToken = document.querySelector('input[name="authenticity_token"]');
    if (inputToken) {
      return inputToken.value;
    }

    return null;
  }

  // GitHub username -> user ID 변환 (캐시 사용)
  const userIdCache = new Map();

  async function getUserId(username) {
    // 캐시 확인
    if (userIdCache.has(username)) {
      return userIdCache.get(username);
    }

    try {
      // GitHub API는 인증 없이도 사용자 정보 조회 가능
      const response = await fetch(`https://api.github.com/users/${username}`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        userIdCache.set(username, data.id);
        return data.id;
      }
    } catch (error) {
      console.error('[ReviewPing] Error fetching user ID:', error);
    }

    return null;
  }

  // GitHub에 리뷰어 추가 (API 사용)
  async function addReviewersViaSession(prInfo, reviewers) {
    console.log('[ReviewPing] addReviewersViaSession called with:', { prNumber: prInfo.prNumber, reviewers });

    const { owner, repo, prNumber } = prInfo;

    // background script를 통해 GitHub API 호출
    const apiResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'ADD_GITHUB_REVIEWERS',
        payload: { owner, repo, prNumber, reviewers }
      }, (response) => {
        console.log('[ReviewPing] GitHub API response:', response);
        resolve(response || { success: false, error: 'No response from background' });
      });
    });

    if (apiResult.success) {
      return { success: true, addedReviewers: reviewers };
    }

    // API 실패 시 세션 기반 fallback 시도 (이미 로그인된 상태 활용)
    console.log('[ReviewPing] GitHub API failed, trying session-based fallback...', apiResult.error);
    return await addReviewersViaSessionFallback(prInfo, reviewers);
  }

  // 세션 기반 리뷰어 추가 (fallback) - GitHub 내부 API 사용
  async function addReviewersViaSessionFallback(prInfo, reviewers) {
    const { owner, repo, prNumber } = prInfo;

    console.log('[ReviewPing] addReviewersViaSessionFallback called:', { owner, repo, prNumber, reviewers });

    // 방법 1: GraphQL API 시도 (GitHub의 내부 GraphQL 사용)
    console.log('[ReviewPing] Trying method 1: GraphQL...');
    const graphqlResult = await tryGraphQLReviewerAdd(owner, repo, prNumber, reviewers);
    console.log('[ReviewPing] GraphQL result:', graphqlResult);
    if (graphqlResult.success) {
      return graphqlResult;
    }

    // 방법 2: GitHub 내부 REST API (form submission 모방)
    console.log('[ReviewPing] Trying method 2: REST API...');
    const restResult = await tryRestAPIReviewerAdd(owner, repo, prNumber, reviewers);
    console.log('[ReviewPing] REST API result:', restResult);
    if (restResult.success) {
      return restResult;
    }

    // 방법 3: GitHub의 reviewer sidebar 클릭 시뮬레이션
    console.log('[ReviewPing] Trying method 3: Click simulation...');
    const clickResult = await tryClickBasedReviewerAdd(reviewers);
    console.log('[ReviewPing] Click result:', clickResult);
    if (clickResult.success) {
      return clickResult;
    }

    // 모든 방법 실패
    console.log('[ReviewPing] All session methods failed');
    return {
      success: false,
      error: 'GitHub Token을 설정하면 더 안정적으로 동작합니다'
    };
  }

  // GitHub 내부 REST API를 통한 리뷰어 추가
  async function tryRestAPIReviewerAdd(owner, repo, prNumber, reviewers) {
    const csrfToken = getCSRFToken();
    if (!csrfToken) {
      return { success: false, error: 'CSRF token not found' };
    }

    // 각 리뷰어의 user ID 가져오기
    const userIds = await Promise.all(
      reviewers.map(async (username) => {
        const id = await getUserId(username);
        return { username, id };
      })
    );

    const validUsers = userIds.filter(u => u.id !== null);
    if (validUsers.length === 0) {
      return { success: false, error: '리뷰어 정보를 가져올 수 없습니다' };
    }

    console.log('[ReviewPing] Valid users for REST API:', validUsers);

    // 각 리뷰어를 개별적으로 추가 (GitHub UI 동작 방식)
    let addedCount = 0;
    for (const user of validUsers) {
      try {
        // GitHub UI가 실제로 사용하는 엔드포인트와 형식
        const response = await fetch(`https://github.com/${owner}/${repo}/pull/${prNumber}/reviewers`, {
          method: 'POST',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include',
          body: new URLSearchParams({
            'authenticity_token': csrfToken,
            'reviewer_user_id': user.id.toString()
          }).toString()
        });

        console.log('[ReviewPing] REST API response for', user.username, ':', response.status);

        if (response.ok || response.status === 200 || response.status === 422) {
          addedCount++;
        }
      } catch (error) {
        console.log('[ReviewPing] REST API error for', user.username, ':', error.message);
      }
    }

    if (addedCount > 0) {
      return { success: true, addedReviewers: validUsers.slice(0, addedCount).map(u => u.username) };
    }

    return { success: false, error: 'REST API failed' };
  }

  // GraphQL API를 통한 리뷰어 추가 시도
  async function tryGraphQLReviewerAdd(owner, repo, prNumber, reviewers) {
    console.log('[ReviewPing] Trying GraphQL reviewer add...');

    // PR의 node ID를 GraphQL로 조회
    const prNodeId = await getPRNodeIdViaGraphQL(owner, repo, prNumber);
    if (!prNodeId) {
      console.log('[ReviewPing] Could not get PR node ID');
      return { success: false, error: 'PR node ID not found' };
    }

    console.log('[ReviewPing] Got PR node ID:', prNodeId);

    // 리뷰어들의 node ID 가져오기
    const reviewerNodeIds = await Promise.all(
      reviewers.map(async (username) => {
        const nodeId = await getUserNodeId(username);
        return { username, nodeId };
      })
    );

    const validReviewers = reviewerNodeIds.filter(r => r.nodeId);
    console.log('[ReviewPing] Valid reviewers with node IDs:', validReviewers);

    if (validReviewers.length === 0) {
      return { success: false, error: 'No valid reviewer node IDs' };
    }

    try {
      const response = await fetch('https://github.com/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          query: `
            mutation RequestReviews($pullRequestId: ID!, $userIds: [ID!]!) {
              requestReviews(input: {pullRequestId: $pullRequestId, userIds: $userIds}) {
                pullRequest {
                  id
                }
              }
            }
          `,
          variables: {
            pullRequestId: prNodeId,
            userIds: validReviewers.map(r => r.nodeId)
          }
        })
      });

      const result = await response.json();
      console.log('[ReviewPing] GraphQL mutation response:', result);

      if (result.data && result.data.requestReviews && !result.errors) {
        return { success: true, addedReviewers: validReviewers.map(r => r.username) };
      }

      const errorMsg = result.errors?.[0]?.message || 'GraphQL mutation failed';
      console.log('[ReviewPing] GraphQL mutation error:', errorMsg);
      return { success: false, error: errorMsg };
    } catch (error) {
      console.log('[ReviewPing] GraphQL error:', error);
      return { success: false, error: error.message };
    }
  }

  // GraphQL로 PR node ID 조회 (세션 기반)
  async function getPRNodeIdViaGraphQL(owner, repo, prNumber) {
    try {
      const response = await fetch('https://github.com/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          query: `
            query GetPRNodeId($owner: String!, $repo: String!, $number: Int!) {
              repository(owner: $owner, name: $repo) {
                pullRequest(number: $number) {
                  id
                }
              }
            }
          `,
          variables: {
            owner: owner,
            repo: repo,
            number: parseInt(prNumber, 10)
          }
        })
      });

      const result = await response.json();
      console.log('[ReviewPing] GraphQL PR query response:', result);

      if (result.data?.repository?.pullRequest?.id) {
        return result.data.repository.pullRequest.id;
      }

      console.log('[ReviewPing] Could not get PR node ID from GraphQL:', result.errors);
      return null;
    } catch (error) {
      console.log('[ReviewPing] GraphQL PR query error:', error);
      return null;
    }
  }

  // 사용자의 node ID 가져오기 (GitHub public API)
  async function getUserNodeId(username) {
    try {
      const response = await fetch(`https://api.github.com/users/${username}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (response.ok) {
        const data = await response.json();
        console.log('[ReviewPing] Got user node ID for', username, ':', data.node_id);
        return data.node_id;
      }
    } catch (e) {
      console.log('[ReviewPing] Error getting user node ID:', e);
    }
    return null;
  }

  // DOM 클릭 기반 리뷰어 추가 시도
  async function tryClickBasedReviewerAdd(reviewers) {
    console.log('[ReviewPing] Trying click-based reviewer add for:', reviewers);

    // 사이드바에서 Reviewers 섹션 찾기
    let reviewersSection = null;
    let detailsElement = null;

    // 방법 1: details 요소 중 Reviewers 관련 찾기
    const allDetails = document.querySelectorAll('.Layout-sidebar details, .discussion-sidebar details, [class*="sidebar"] details');
    for (const details of allDetails) {
      const text = details.textContent || '';
      if (text.includes('Reviewers') || text.includes('리뷰어')) {
        detailsElement = details;
        reviewersSection = details;
        console.log('[ReviewPing] Found Reviewers details element');
        break;
      }
    }

    // 방법 2: 사이드바 아이템에서 찾기
    if (!reviewersSection) {
      const sidebarSelectors = [
        '.Layout-sidebar .discussion-sidebar-item',
        '.discussion-sidebar-item',
        '[data-testid="sidebar-reviewers"]',
        '.js-discussion-sidebar-item',
        '#partial-discussion-sidebar .js-issue-sidebar-form'
      ];

      for (const selector of sidebarSelectors) {
        const items = document.querySelectorAll(selector);
        for (const item of items) {
          const labelText = item.textContent || '';
          if (labelText.includes('Reviewers') || labelText.includes('리뷰어')) {
            reviewersSection = item;
            detailsElement = item.querySelector('details');
            console.log('[ReviewPing] Found Reviewers section with:', selector);
            break;
          }
        }
        if (reviewersSection) break;
      }
    }

    if (!reviewersSection) {
      console.log('[ReviewPing] Reviewers section not found in sidebar');
      return { success: false, error: 'Reviewers 섹션을 찾을 수 없습니다' };
    }

    // 톱니바퀴/summary 버튼 찾기
    let gearButton = reviewersSection.querySelector('summary') ||
                     reviewersSection.querySelector('[aria-label*="reviewer" i]') ||
                     reviewersSection.querySelector('.octicon-gear')?.closest('summary, button');

    if (!gearButton && detailsElement) {
      gearButton = detailsElement.querySelector('summary');
    }

    if (!gearButton) {
      console.log('[ReviewPing] Gear button not found');
      return { success: false, error: 'Reviewers 설정 버튼을 찾을 수 없습니다' };
    }

    // 메뉴 열기
    console.log('[ReviewPing] Opening reviewer menu...');
    gearButton.click();
    await new Promise(r => setTimeout(r, 800));

    // details가 열렸는지 확인
    if (detailsElement && !detailsElement.hasAttribute('open')) {
      detailsElement.setAttribute('open', '');
      await new Promise(r => setTimeout(r, 500));
    }

    let addedCount = 0;

    for (const reviewer of reviewers) {
      console.log('[ReviewPing] Processing reviewer:', reviewer);

      // 검색 input 찾기 (있으면 검색 수행)
      const searchInput = document.querySelector(
        'details[open] input[type="text"], ' +
        'details[open] input[placeholder*="Filter"], ' +
        'details[open] input[placeholder*="Search"], ' +
        'details[open] input[aria-label*="Filter"], ' +
        '.SelectMenu-input, ' +
        '[data-filterable-for] input'
      );

      if (searchInput) {
        console.log('[ReviewPing] Found search input, searching for:', reviewer);
        searchInput.value = reviewer;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
      }

      // 열린 메뉴에서 리뷰어 찾기
      const menuContainer = document.querySelector('details[open]') || detailsElement || document;

      // 다양한 방법으로 리뷰어 아이템 찾기
      let reviewerItem = null;

      // 1. data-login 속성으로 찾기
      reviewerItem = menuContainer.querySelector(`[data-login="${reviewer}"]`) ||
                     menuContainer.querySelector(`[data-login="${reviewer.toLowerCase()}"]`) ||
                     document.querySelector(`details[open] [data-login="${reviewer}"]`);

      // 2. input value로 찾기
      if (!reviewerItem) {
        const input = menuContainer.querySelector(`input[value="${reviewer}"], input[value="${reviewer.toLowerCase()}"]`) ||
                     document.querySelector(`details[open] input[value="${reviewer}"]`);
        if (input) {
          reviewerItem = input.closest('label, .select-menu-item, .ActionListItem, [role="option"]') || input;
        }
      }

      // 3. label 텍스트로 찾기
      if (!reviewerItem) {
        const labels = menuContainer.querySelectorAll('label, .select-menu-item, .ActionListItem, [role="menuitemcheckbox"], [role="option"]');
        for (const label of labels) {
          const text = (label.textContent || '').trim().toLowerCase();
          if (text.includes(reviewer.toLowerCase())) {
            reviewerItem = label;
            console.log('[ReviewPing] Found reviewer by text in:', label.className || label.tagName);
            break;
          }
        }
      }

      // 4. 전체 문서에서 열린 드롭다운 내 검색
      if (!reviewerItem) {
        const openMenu = document.querySelector('details[open] .SelectMenu-list, details[open] .select-menu-list, details[open] [role="menu"]');
        if (openMenu) {
          const items = openMenu.querySelectorAll('label, [role="menuitemcheckbox"], [role="option"], .select-menu-item');
          for (const item of items) {
            if ((item.textContent || '').toLowerCase().includes(reviewer.toLowerCase())) {
              reviewerItem = item;
              console.log('[ReviewPing] Found in open menu');
              break;
            }
          }
        }
      }

      if (reviewerItem) {
        // 클릭 가능한 요소 찾기
        const checkbox = reviewerItem.querySelector('input[type="checkbox"]');
        const clickTarget = checkbox || reviewerItem;

        // 이미 선택되어 있는지 확인
        const isChecked = checkbox?.checked ||
                         reviewerItem.classList.contains('selected') ||
                         reviewerItem.getAttribute('aria-checked') === 'true' ||
                         reviewerItem.querySelector('.octicon-check');

        if (!isChecked) {
          console.log('[ReviewPing] Clicking to add reviewer:', reviewer);
          clickTarget.click();
          addedCount++;
          await new Promise(r => setTimeout(r, 500));
        } else {
          console.log('[ReviewPing] Reviewer already selected:', reviewer);
          addedCount++;
        }
      } else {
        console.log('[ReviewPing] Could not find reviewer item for:', reviewer);
      }

      // 검색 초기화
      if (searchInput) {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // 메뉴 닫기
    await new Promise(r => setTimeout(r, 300));
    if (detailsElement) {
      detailsElement.removeAttribute('open');
    }
    document.body.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));

    if (addedCount > 0) {
      console.log('[ReviewPing] Successfully added reviewers via click:', addedCount);
      return { success: true, addedReviewers: reviewers.slice(0, addedCount) };
    }

    return { success: false, error: '리뷰어 목록에서 사용자를 찾을 수 없습니다' };
  }

  // 이전 PR 상태 추적 (머지 감지용)
  let previousMergeState = false;

  // 머지 상태 체크 디바운싱
  let mergeCheckTimeout = null;

  // PR이 머지되었는지 확인 (엄격한 체크)
  function isMerged() {
    // 방법 1: PR 헤더의 상태 뱃지 확인
    const headerArea = document.querySelector('.gh-header-meta, .gh-header-show, #partial-discussion-header');

    if (headerArea) {
      // 헤더 내의 머지 상태만 확인
      const mergeSelectors = [
        '.State--merged',                           // 머지된 상태 뱃지
        '[data-testid="state-label-merged"]',       // 새로운 UI의 머지 라벨
        '.State--purple'                            // 보라색 상태 뱃지 (머지됨)
      ];

      for (const selector of mergeSelectors) {
        const el = headerArea.querySelector(selector);
        if (el) {
          console.log('[ReviewPing] Merge detected via selector:', selector);
          return true;
        }
      }

      // 헤더 내 텍스트로 확인 (백업 방법)
      const stateLabels = headerArea.querySelectorAll('.State, [data-testid="state-label"]');
      for (const label of stateLabels) {
        const text = label.textContent.trim().toLowerCase();
        if (text === 'merged') {
          console.log('[ReviewPing] Merge detected via text label');
          return true;
        }
      }
    }

    // 방법 2: 페이지 전체에서 머지 상태 확인 (GitHub UI 변경 대응)
    const globalMergeIndicators = [
      '.merged-status-badge',
      '[data-testid="merged-badge"]',
      '.octicon-git-merge.color-fg-done',
      '.TimelineItem .octicon-git-merge'
    ];

    for (const selector of globalMergeIndicators) {
      const el = document.querySelector(selector);
      if (el) {
        // 타임라인의 머지 아이콘인 경우, 실제 머지 완료인지 확인
        const timelineItem = el.closest('.TimelineItem');
        if (timelineItem) {
          const text = timelineItem.textContent.toLowerCase();
          if (text.includes('merged')) {
            console.log('[ReviewPing] Merge detected via timeline:', selector);
            return true;
          }
        } else {
          console.log('[ReviewPing] Merge detected via global selector:', selector);
          return true;
        }
      }
    }

    // 방법 3: 머지 메시지 확인
    const mergeMessage = document.querySelector('.merge-message, [data-testid="merge-message"]');
    if (mergeMessage && mergeMessage.textContent.toLowerCase().includes('merged')) {
      console.log('[ReviewPing] Merge detected via merge message');
      return true;
    }

    return false;
  }

  // 머지 알림 전송
  async function sendMergeNotification(prInfo) {
    // 이미 알림을 보낸 PR인지 확인
    if (notifiedMerges.has(prInfo.url)) {
      return;
    }

    // 중복 전송 방지: 전송 시작 전에 먼저 추가
    notifiedMerges.add(prInfo.url);

    // 머지 알림 활성화 여부 확인
    try {
      const settings = await chrome.storage.sync.get({ mergeNotificationEnabled: true });
      if (!settings.mergeNotificationEnabled) {
        return;
      }
    } catch (error) {
      console.error('[ReviewPing] Error checking merge notification setting:', error);
      return;
    }

    console.log('[ReviewPing] Sending merge notification for:', prInfo.url);

    // 알림 전송
    chrome.runtime.sendMessage({
      type: 'SEND_SLACK_MESSAGE',
      payload: {
        action: 'merge',
        prInfo
      }
    }, (response) => {
      if (response && response.success) {
        // 성공 시 알림 전송 목록에 추가 (메모리 + storage)
        notifiedMerges.add(prInfo.url);
        // storage에도 저장하여 페이지 새로고침 후에도 유지
        chrome.storage.local.get({ notifiedMerges: [] }, (result) => {
          const stored = new Set(result.notifiedMerges);
          stored.add(prInfo.url);
          chrome.storage.local.set({ notifiedMerges: Array.from(stored) });
        });
        console.log('[ReviewPing] Merge notification sent successfully');
      } else {
        const errorMsg = response?.error || '알림을 보내는데 실패했습니다.';
        console.error('[ReviewPing] Failed to send merge notification:', errorMsg);
        showToast(errorMsg, 'error');
      }
    });
  }

  // 머지 상태 변화 감지 및 알림 (디바운싱 적용)
  async function checkMergeState() {
    const currentMergeState = isMerged();

    console.log('[ReviewPing] Checking merge state:', { current: currentMergeState, previous: previousMergeState });

    // 머지 상태가 false → true로 변경된 경우에만 알림
    if (currentMergeState && !previousMergeState) {
      console.log('[ReviewPing] Merge state changed: false → true');
      const prInfo = getPRInfo();
      if (prInfo) {
        // 허용된 저장소인지 확인
        const allowed = await isRepoAllowed(prInfo.owner, prInfo.repo);
        console.log('[ReviewPing] Repo allowed:', allowed, prInfo.owner + '/' + prInfo.repo);
        if (allowed) {
          await sendMergeNotification(prInfo);
        }
      }
    }

    previousMergeState = currentMergeState;
  }

  // PR 페이지인지 확인
  function isPRPage() {
    return /github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(window.location.href);
  }

  if (!isPRPage()) {
    return;
  }

  // 현재 저장소가 허용 목록에 있는지 확인
  async function isRepoAllowed(owner, repo) {
    try {
      const settings = await chrome.storage.sync.get({ allowedRepos: [] });
      const allowedRepos = settings.allowedRepos || [];

      // 허용 목록이 비어있으면 모든 저장소 허용
      if (allowedRepos.length === 0) {
        return true;
      }

      const currentRepo = `${owner}/${repo}`.toLowerCase();
      const currentOwner = owner.toLowerCase();

      return allowedRepos.some(allowed => {
        const normalizedAllowed = allowed.toLowerCase();
        // owner/* 패턴 (organization 전체)
        if (normalizedAllowed.endsWith('/*')) {
          const allowedOwner = normalizedAllowed.slice(0, -2);
          return currentOwner === allowedOwner;
        }
        // owner/repo 패턴 (특정 저장소)
        return currentRepo === normalizedAllowed;
      });
    } catch (error) {
      console.error('[ReviewPing] Error checking allowed repos:', error);
      return true; // 에러 시 기본적으로 허용
    }
  }

  // PR 정보 추출
  function getPRInfo() {
    const url = window.location.href;
    const pathMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);

    if (!pathMatch) return null;

    const [, owner, repo, prNumber] = pathMatch;

    // PR 제목 - 여러 셀렉터 시도
    const titleSelectors = [
      '.js-issue-title',
      '.gh-header-title .markdown-title',
      '[data-testid="issue-title"]',
      'bdi.js-issue-title',
      'h1.gh-header-title span'
    ];

    let title = `PR #${prNumber}`;
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        title = el.textContent.trim();
        break;
      }
    }

    // PR 작성자 - 여러 셀렉터 시도
    const authorSelectors = [
      '.pull-header-username',
      '.author',
      '[data-testid="author-login"]',
      'a.author',
      '.gh-header-meta a.Link--secondary'
    ];

    let author = '';
    for (const selector of authorSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        author = el.textContent.trim();
        break;
      }
    }

    // 현재 로그인한 사용자
    const currentUserElement = document.querySelector('meta[name="user-login"]');
    const currentUser = currentUserElement ? currentUserElement.getAttribute('content') : '';

    // 리뷰어 목록
    const reviewerSelectors = [
      // 새로운 GitHub UI 셀렉터
      '[data-testid="reviewers-list"] .css-truncate-target',
      '[data-testid="reviewers-list"] a[data-hovercard-type="user"]',
      '#reviewers-select-menu .css-truncate-target',
      // Sidebar 리뷰어 영역
      '.sidebar-reviewers .assignee',
      '.sidebar-reviewers .css-truncate-target',
      'form[data-target="reviewers-select-menu"] .css-truncate-target',
      // 기존 셀렉터 (fallback)
      '.reviewer-username',
      '[data-hovercard-type="user"].assignee',
      '.sidebar-assignee .assignee',
      '[data-testid="reviewers-list"] a'
    ];

    let reviewers = [];
    for (const selector of reviewerSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        reviewers = Array.from(elements).map(el => el.textContent.trim()).filter(Boolean);
        if (reviewers.length > 0) break;
      }
    }

    // 봇 계정 필터링
    const botPatterns = [
      /\[bot\]/i,           // [bot] 포함
      /bot\]$/i,            // bot]로 끝남
      /^cursor/i,           // cursor로 시작 (cursor[bot] 등)
      /^dependabot/i,       // dependabot
      /^renovate/i,         // renovate
      /^github-actions/i,   // github-actions
      /^codecov/i,          // codecov
      /^sonarcloud/i        // sonarcloud
    ];
    reviewers = reviewers.filter(reviewer => {
      const isBot = botPatterns.some(pattern => pattern.test(reviewer));
      if (isBot) {
        console.log('[ReviewPing] Filtered out bot:', reviewer);
      }
      return !isBot;
    });

    // 현재 사용자의 첫 번째 리뷰 코멘트 가져오기 (리뷰 완료 시 사용)
    let reviewComment = '';

    // 무시할 텍스트 패턴 (빈 상태 메시지)
    const ignoredPatterns = [
      /^nothing to preview/i,
      /^no content/i,
      /^preview.*loading/i,
      /^\s*$/
    ];

    // 1차: 현재 사용자의 리뷰 이벤트에서 메인 리뷰 본문 찾기 (첫 번째부터)
    // 리뷰 이벤트는 "requested changes", "approved", "commented" 등의 액션이 있는 타임라인 아이템
    const reviewEvents = document.querySelectorAll('.js-timeline-item');
    for (let i = 0; i < reviewEvents.length; i++) {
      const event = reviewEvents[i];

      // 리뷰 이벤트인지 확인 (review-body가 있는 경우)
      const reviewBody = event.querySelector('.review-body');
      if (!reviewBody) continue;

      // 현재 사용자의 리뷰인지 확인
      const authorEl = event.querySelector('.author, [data-hovercard-type="user"]');
      if (authorEl) {
        const reviewAuthor = authorEl.textContent.trim().toLowerCase();
        if (currentUser && reviewAuthor !== currentUser.toLowerCase()) {
          continue; // 다른 사용자의 리뷰는 스킵
        }
      }

      // 메인 리뷰 본문 추출 (코드 코멘트 제외)
      const commentBody = reviewBody.querySelector('.comment-body, .markdown-body');
      if (commentBody) {
        const text = commentBody.textContent.trim();
        const isIgnored = ignoredPatterns.some(pattern => pattern.test(text));
        if (text && !isIgnored) {
          reviewComment = text;
          console.log('[ReviewPing] Found first review comment from current user');
          break;
        }
      }
    }

    // 2차: 메인 리뷰 본문을 못 찾은 경우 폴백 (기존 로직)
    if (!reviewComment) {
      const fallbackSelectors = [
        // 리뷰 요약 코멘트 (리뷰 제출 시 남기는 코멘트)
        '.js-timeline-item .review-body .comment-body',
        '.js-timeline-item .review-body .markdown-body',
        '[data-testid="review-body"] .markdown-body'
      ];

      for (const selector of fallbackSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          // 앞에서부터 찾기 (첫 번째 코멘트)
          for (let i = 0; i < elements.length; i++) {
            const text = elements[i].textContent.trim();
            // 빈 상태 메시지 필터링
            const isIgnored = ignoredPatterns.some(pattern => pattern.test(text));
            if (text && !isIgnored) {
              reviewComment = text;
              break;
            }
          }
          if (reviewComment) break;
        }
      }
    }

    console.log('[ReviewPing] PR Info:', { owner, repo, prNumber, title, author, currentUser, reviewers, reviewComment: reviewComment.substring(0, 50) });

    return {
      url,
      owner,
      repo,
      prNumber,
      title,
      author,
      currentUser,
      reviewers,
      reviewComment,
      isMyPR: author.toLowerCase() === currentUser.toLowerCase()
    };
  }

  // PR 타임라인에서 최근 참여자 추출 (리뷰어 제안용)
  function getSuggestedReviewers(currentUser, author) {
    const participants = new Set();

    // 코멘트 작성자들
    const commentAuthors = document.querySelectorAll('.timeline-comment-header .author, .review-comment .author, .js-comment .author');
    commentAuthors.forEach(el => {
      const username = el.textContent.trim();
      if (username) participants.add(username);
    });

    // 리뷰 작성자들
    const reviewAuthors = document.querySelectorAll('.js-timeline-item .author');
    reviewAuthors.forEach(el => {
      const username = el.textContent.trim();
      if (username) participants.add(username);
    });

    // Assignees
    const assignees = document.querySelectorAll('.assignee .css-truncate-target, [data-hovercard-type="user"].assignee');
    assignees.forEach(el => {
      const username = el.textContent.trim();
      if (username) participants.add(username);
    });

    // 현재 사용자와 PR 작성자 제외, 봇 계정 필터링
    const currentUserLower = currentUser.toLowerCase();
    const authorLower = author.toLowerCase();
    const botPatterns = [
      /\[bot\]/i, /bot\]$/i, /^cursor/i, /^dependabot/i,
      /^renovate/i, /^github-actions/i, /^codecov/i, /^sonarcloud/i
    ];

    return Array.from(participants).filter(p => {
      const pLower = p.toLowerCase();
      const isBot = botPatterns.some(pattern => pattern.test(p));
      return pLower !== currentUserLower && pLower !== authorLower && p.length > 0 && !isBot;
    });
  }

  // 토스트 알림 표시
  function showToast(message, type = 'success') {
    // 기존 토스트 제거
    const existingToast = document.getElementById('reviewping-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'reviewping-toast';

    const bgColor = type === 'success' ? '#238636' : '#da3633';
    const icon = type === 'success'
      ? '<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>'
      : '<path d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657zM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94 6.03 4.97z"/>';

    toast.style.cssText = `
      position: fixed !important;
      bottom: 80px !important;
      right: 24px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 12px 16px !important;
      background-color: ${bgColor} !important;
      color: #ffffff !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      border-radius: 8px !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
      animation: reviewping-toast-in 0.3s ease !important;
    `;

    toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">${icon}</svg>
      <span>${message}</span>
    `;

    // 애니메이션 스타일 추가
    if (!document.getElementById('reviewping-toast-style')) {
      const style = document.createElement('style');
      style.id = 'reviewping-toast-style';
      style.textContent = `
        @keyframes reviewping-toast-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes reviewping-toast-out {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(10px); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // 3초 후 제거
    setTimeout(() => {
      toast.style.animation = 'reviewping-toast-out 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // 리뷰 완료 확인 모달
  function showReviewCompleteModal(prInfo, onConfirm) {
    // 기존 모달 제거
    const existingModal = document.getElementById('reviewping-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'reviewping-modal';
    modal.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      background-color: rgba(0, 0, 0, 0.5) !important;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background-color: #161b22 !important;
      border: 1px solid #30363d !important;
      border-radius: 12px !important;
      padding: 24px !important;
      min-width: 320px !important;
      max-width: 480px !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4) !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    `;

    modalContent.innerHTML = `
      <h3 style="color: #f0f6fc; font-size: 16px; font-weight: 600; margin: 0 0 16px 0;">리뷰 완료</h3>
      <p style="color: #c9d1d9; font-size: 14px; margin-bottom: 12px;">
        <strong style="color: #8957e5;">${prInfo.author}</strong> 님께 리뷰 완료 알림을 보냅니다.
      </p>
      <p style="color: #8b949e; font-size: 12px; margin: 12px 0 20px 0; padding: 8px 12px; background-color: #0d1117; border-radius: 6px;">
        📋 ${prInfo.title}
      </p>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="reviewping-modal-cancel" style="
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 500;
          color: #c9d1d9;
          background-color: #21262d;
          border: 1px solid #30363d;
          border-radius: 6px;
          cursor: pointer;
        ">취소</button>
        <button id="reviewping-modal-confirm" style="
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 500;
          color: #ffffff;
          background-color: #8957e5;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        ">보내기</button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // 취소 버튼
    document.getElementById('reviewping-modal-cancel').addEventListener('click', () => {
      modal.remove();
    });

    // 배경 클릭 시 닫기
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // ESC 키로 닫기
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // 확인 버튼
    document.getElementById('reviewping-modal-confirm').addEventListener('click', () => {
      modal.remove();
      onConfirm();
    });
  }

  // 리뷰 요청 모달 생성 및 표시
  async function showReviewRequestModal(prInfo, onConfirm) {
    // 기존 모달 제거
    const existingModal = document.getElementById('reviewping-modal');
    if (existingModal) existingModal.remove();

    const reviewers = prInfo.reviewers.filter(r => r.toLowerCase() !== prInfo.author.toLowerCase());
    const hasReviewers = reviewers.length > 0;

    // 리뷰어가 없을 때 히스토리에서 추천
    let historyReviewers = [];
    if (!hasReviewers) {
      const history = await getReviewerHistory(prInfo.owner, prInfo.repo);
      // 현재 사용자와 PR 작성자 제외
      historyReviewers = history.filter(r =>
        r.toLowerCase() !== prInfo.currentUser.toLowerCase() &&
        r.toLowerCase() !== prInfo.author.toLowerCase()
      );
    }

    // 타임라인 참여자 (히스토리에 없는 사람만)
    const timelineReviewers = getSuggestedReviewers(prInfo.currentUser, prInfo.author)
      .filter(r => !historyReviewers.includes(r));

    // 선택된 리뷰어 추적
    let selectedReviewers = hasReviewers ? [...reviewers] : [];

    // GitHub 리뷰어 추가 설정 가져오기
    const settings = await chrome.storage.sync.get({ autoAddReviewers: true, githubToken: '' });
    const hasGithubToken = !!settings.githubToken;
    // 로그인 여부 확인 (여러 방법 시도)
    const userLoginMeta = document.querySelector('meta[name="user-login"]')?.getAttribute('content');
    const userLoginFromHeader = document.querySelector('.Header-link.name, [data-login]')?.getAttribute('data-login');
    const isLoggedIn = !!(userLoginMeta || userLoginFromHeader || prInfo.currentUser);
    // 리뷰어 추가 기본값: 항상 true (체크박스로 사용자가 제어)
    let addToGithub = settings.autoAddReviewers;

    console.log('[ReviewPing] Modal settings:', {
      hasGithubToken,
      isLoggedIn,
      addToGithub,
      hasReviewers,
      historyReviewers: historyReviewers.length,
      timelineReviewers: timelineReviewers.length,
      currentUser: prInfo.currentUser,
      userLoginMeta,
      userLoginFromHeader
    });

    const modal = document.createElement('div');
    modal.id = 'reviewping-modal';
    modal.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      background-color: rgba(0, 0, 0, 0.5) !important;
      animation: reviewping-modal-bg-in 0.2s ease !important;
    `;

    // 모달 애니메이션 스타일 추가
    if (!document.getElementById('reviewping-modal-style')) {
      const style = document.createElement('style');
      style.id = 'reviewping-modal-style';
      style.textContent = `
        @keyframes reviewping-modal-bg-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes reviewping-modal-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `;
      document.head.appendChild(style);
    }

    const reviewerListHTML = hasReviewers
      ? `<div class="reviewping-modal-reviewers">
          ${reviewers.map(r => `<span class="reviewping-reviewer-tag selected" data-reviewer="${r}">${r}</span>`).join('')}
        </div>`
      : '';

    // 이전에 리뷰 요청했던 사람 (히스토리)
    const historyHTML = !hasReviewers && historyReviewers.length > 0
      ? `<div class="reviewping-modal-suggested">
          <p style="color: #8b949e; font-size: 12px; margin-bottom: 8px;">📌 이전에 리뷰 요청했던 사람:</p>
          <div class="reviewping-modal-reviewers">
            ${historyReviewers.map(r => `<span class="reviewping-reviewer-tag" data-reviewer="${r}">${r}</span>`).join('')}
          </div>
        </div>`
      : '';

    // 타임라인 참여자 (히스토리와 별도로 표시)
    const timelineHTML = !hasReviewers && timelineReviewers.length > 0
      ? `<div class="reviewping-modal-suggested" style="margin-top: 12px;">
          <p style="color: #8b949e; font-size: 12px; margin-bottom: 8px;">💬 이 PR 참여자:</p>
          <div class="reviewping-modal-reviewers">
            ${timelineReviewers.map(r => `<span class="reviewping-reviewer-tag" data-reviewer="${r}">${r}</span>`).join('')}
          </div>
        </div>`
      : '';

    const noReviewerWarning = !hasReviewers && historyReviewers.length === 0 && timelineReviewers.length === 0
      ? `<p style="color: #d29922; font-size: 13px;">리뷰어가 지정되지 않았습니다. "팀원분들"에게 요청됩니다.</p>`
      : '';

    // GitHub에 리뷰어 추가 체크박스 (기존 리뷰어가 없고, 히스토리/타임라인에서 선택 가능한 경우)
    const showGithubCheckbox = !hasReviewers && (historyReviewers.length > 0 || timelineReviewers.length > 0);
    const tokenWarning = !hasGithubToken
      ? `<span style="color: #d29922; font-size: 11px; display: block; margin-top: 4px;">⚠️ GitHub Token을 설정하면 더 안정적으로 작동합니다 (설정 페이지)</span>`
      : '';
    const githubCheckboxHTML = showGithubCheckbox
      ? `<label class="reviewping-github-checkbox" style="display: flex; align-items: center; gap: 8px; margin-top: 12px; cursor: pointer;">
          <input type="checkbox" id="reviewping-add-to-github" ${addToGithub ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer;">
          <span style="color: #c9d1d9; font-size: 13px;">GitHub PR에도 리뷰어 추가</span>
        </label>${tokenWarning}`
      : '';

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background-color: #161b22 !important;
      border: 1px solid #30363d !important;
      border-radius: 12px !important;
      padding: 24px !important;
      min-width: 320px !important;
      max-width: 480px !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4) !important;
      animation: reviewping-modal-in 0.2s ease !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    `;

    modalContent.innerHTML = `
      <h3 style="color: #f0f6fc; font-size: 16px; font-weight: 600; margin: 0 0 16px 0;">리뷰 요청</h3>
      ${hasReviewers
        ? `<p style="color: #c9d1d9; font-size: 14px; margin-bottom: 12px;">
            <strong style="color: #58a6ff;">${reviewers.join(', ')}</strong> 님께 리뷰 요청을 보냅니다.
          </p>`
        : ''
      }
      ${reviewerListHTML}
      ${historyHTML}
      ${timelineHTML}
      ${noReviewerWarning}
      ${githubCheckboxHTML}
      <p style="color: #8b949e; font-size: 12px; margin: 12px 0 20px 0; padding: 8px 12px; background-color: #0d1117; border-radius: 6px;">
        📋 ${prInfo.title}
      </p>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="reviewping-modal-cancel" style="
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 500;
          color: #c9d1d9;
          background-color: #21262d;
          border: 1px solid #30363d;
          border-radius: 6px;
          cursor: pointer;
        ">취소</button>
        <button id="reviewping-modal-confirm" style="
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 500;
          color: #ffffff;
          background-color: #238636;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        ">보내기</button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // 리뷰어 태그 스타일 추가
    if (!document.getElementById('reviewping-reviewer-style')) {
      const style = document.createElement('style');
      style.id = 'reviewping-reviewer-style';
      style.textContent = `
        .reviewping-modal-reviewers {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        .reviewping-reviewer-tag {
          padding: 6px 12px;
          font-size: 13px;
          color: #8b949e;
          background-color: #21262d;
          border: 1px solid #30363d;
          border-radius: 20px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .reviewping-reviewer-tag:hover {
          border-color: #58a6ff;
          color: #c9d1d9;
        }
        .reviewping-reviewer-tag.selected {
          background-color: #238636;
          border-color: #238636;
          color: #ffffff;
        }
      `;
      document.head.appendChild(style);
    }

    // 리뷰어 태그 클릭 이벤트
    modalContent.querySelectorAll('.reviewping-reviewer-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const reviewer = tag.dataset.reviewer;
        if (tag.classList.contains('selected')) {
          tag.classList.remove('selected');
          selectedReviewers = selectedReviewers.filter(r => r !== reviewer);
        } else {
          tag.classList.add('selected');
          selectedReviewers.push(reviewer);
        }
      });
    });

    // GitHub 리뷰어 추가 체크박스 이벤트
    const githubCheckbox = document.getElementById('reviewping-add-to-github');
    if (githubCheckbox) {
      githubCheckbox.addEventListener('change', (e) => {
        addToGithub = e.target.checked;
        console.log('[ReviewPing] addToGithub changed:', addToGithub);
      });
    }

    // 취소 버튼
    document.getElementById('reviewping-modal-cancel').addEventListener('click', () => {
      modal.remove();
    });

    // 배경 클릭 시 닫기
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // ESC 키로 닫기
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // 확인 버튼
    document.getElementById('reviewping-modal-confirm').addEventListener('click', async () => {
      modal.remove();

      // 선택된 리뷰어가 있고, 기존에 리뷰어가 없었으면 GitHub에 추가 시도
      let githubReviewersAdded = false;

      // 조건 체크 및 디버깅
      const canAddReviewers = selectedReviewers.length > 0;
      const noExistingReviewers = !hasReviewers;
      const githubAddEnabled = addToGithub;

      console.log('[ReviewPing] Confirm clicked:', {
        selectedReviewers,
        hasReviewers,
        isLoggedIn,
        addToGithub,
        canAddReviewers,
        noExistingReviewers,
        githubAddEnabled,
        showGithubCheckbox
      });

      // 디버그: 현재 상태 표시
      console.log('[ReviewPing] Debug state:', {
        selectedReviewers,
        canAddReviewers,
        noExistingReviewers,
        githubAddEnabled,
        showGithubCheckbox
      });

      // 리뷰어를 선택하지 않은 경우 - Slack 알림만 전송 (팀원분들에게)
      if (!canAddReviewers) {
        console.log('[ReviewPing] No reviewers selected, sending to team');
        showToast('리뷰어 미선택 - 팀원분들에게 전송', 'success');
        const updatedPrInfo = { ...prInfo, reviewers: [], githubReviewersAdded: false };
        onConfirm(updatedPrInfo);
        return;
      }

      // 기존 리뷰어가 있는 경우 - GitHub 추가 없이 Slack만 전송
      if (!noExistingReviewers) {
        console.log('[ReviewPing] Existing reviewers found, skipping GitHub add');
        showToast('기존 리뷰어 있음 - Slack만 전송', 'success');
        const updatedPrInfo = { ...prInfo, reviewers: selectedReviewers, githubReviewersAdded: false };
        onConfirm(updatedPrInfo);
        return;
      }

      // 선택된 리뷰어가 있고, 기존 리뷰어가 없는 경우 - GitHub 추가 시도
      if (githubAddEnabled) {
        showToast(`GitHub 리뷰어 추가 중: ${selectedReviewers.join(', ')}`, 'success');

        try {
          console.log('[ReviewPing] Calling addReviewersViaSession with:', selectedReviewers);
          const result = await addReviewersViaSession(prInfo, selectedReviewers);
          console.log('[ReviewPing] addReviewersViaSession result:', result);

          if (result.success) {
            githubReviewersAdded = true;
            showToast(`GitHub 리뷰어 추가 완료!`, 'success');
          } else {
            console.error('[ReviewPing] GitHub reviewer add failed:', result.error);
            showToast(`GitHub 리뷰어 추가 실패: ${result.error}`, 'error');
          }
        } catch (error) {
          console.error('[ReviewPing] addReviewersViaSession error:', error);
          showToast(`오류: ${error.message}`, 'error');
        }
      } else {
        console.log('[ReviewPing] GitHub add disabled - checkbox unchecked or not shown');
        showToast(`체크박스가 체크되지 않아 GitHub 리뷰어 추가 건너뜀`, 'error');
      }

      // 선택된 리뷰어로 prInfo 업데이트 후 Slack 알림 전송
      const updatedPrInfo = { ...prInfo, reviewers: selectedReviewers, githubReviewersAdded };
      onConfirm(updatedPrInfo);

      // GitHub 리뷰어 추가 성공 시 페이지 새로고침
      if (githubReviewersAdded) {
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    });
  }

  // Floating 버튼 UI 생성
  function createFloatingButton(prInfo) {
    const container = document.createElement('div');
    container.id = 'reviewping-container';

    // 인라인 스타일 (CSS 로드 문제 방지)
    container.style.cssText = `
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      z-index: 2147483647 !important;
      display: block !important;
      visibility: visible !important;
    `;

    const button = document.createElement('button');
    button.id = 'reviewping-button';
    button.className = 'reviewping-btn';

    const isRequest = prInfo.isMyPR;
    const bgColor = isRequest ? '#238636' : '#8957e5';
    const hoverColor = isRequest ? '#2ea043' : '#9a6fed';

    // 버튼 인라인 스타일
    button.style.cssText = `
      display: inline-flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 12px 20px !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      line-height: 20px !important;
      color: #ffffff !important;
      background-color: ${bgColor} !important;
      border: none !important;
      border-radius: 12px !important;
      cursor: pointer !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
      transition: all 0.2s ease !important;
      visibility: visible !important;
      opacity: 1 !important;
    `;

    // 호버 효과
    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = hoverColor;
      button.style.transform = 'translateY(-2px)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = bgColor;
      button.style.transform = 'translateY(0)';
    });

    if (prInfo.isMyPR) {
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink: 0;">
          <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0zm4.879-2.773l4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215z"/>
        </svg>
        <span>리뷰 요청</span>
      `;
      button.dataset.action = 'request';
    } else {
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink: 0;">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
        </svg>
        <span>리뷰 완료</span>
      `;
      button.dataset.action = 'complete';
    }

    container.appendChild(button);

    // 클릭 이벤트
    button.addEventListener('click', () => {
      handleButtonClick(prInfo, button.dataset.action);
    });

    return container;
  }

  // 실제 메시지 전송 함수
  function sendSlackNotification(prInfo, action) {
    const button = document.getElementById('reviewping-button');
    const originalContent = button.innerHTML;
    const isRequest = action === 'request';
    const bgColor = isRequest ? '#238636' : '#8957e5';

    // 로딩 상태
    button.disabled = true;
    button.style.backgroundColor = bgColor;
    button.innerHTML = `
      <svg class="reviewping-spinner" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="animation: reviewping-spin 1s linear infinite;">
        <path d="M8 0a8 8 0 1 0 8 8h-1.5A6.5 6.5 0 1 1 8 1.5V0z"/>
      </svg>
      <span>전송 중...</span>
    `;

    // 스피너 애니메이션 추가
    if (!document.getElementById('reviewping-spinner-style')) {
      const style = document.createElement('style');
      style.id = 'reviewping-spinner-style';
      style.textContent = `
        @keyframes reviewping-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    // Background script로 메시지 전송
    chrome.runtime.sendMessage({
      type: 'SEND_SLACK_MESSAGE',
      payload: {
        action,
        prInfo
      }
    }, (response) => {
      button.disabled = false;
      button.innerHTML = originalContent;
      button.style.backgroundColor = bgColor;

      if (response && response.success) {
        const reviewerNames = prInfo.reviewers.length > 0
          ? prInfo.reviewers.join(', ')
          : '팀원분들';
        let successMsg = action === 'request'
          ? `${reviewerNames}님께 리뷰 요청을 보냈습니다`
          : '리뷰 완료 알림을 보냈습니다';

        // GitHub 리뷰어 추가 성공 시 메시지에 추가
        if (action === 'request' && prInfo.githubReviewersAdded) {
          successMsg += ' (GitHub 리뷰어 등록됨)';
        }
        showToast(successMsg, 'success');

        // 리뷰 요청 성공 시 리뷰어 히스토리 저장
        if (action === 'request' && prInfo.reviewers.length > 0) {
          saveReviewerHistory(prInfo.owner, prInfo.repo, prInfo.reviewers);
        }
      } else {
        const errorMsg = response?.error || '알림을 보내는데 실패했습니다.';
        showToast(errorMsg, 'error');
      }
    });
  }

  // 버튼 클릭 핸들러
  function handleButtonClick(prInfo, action) {
    if (action === 'request') {
      // 리뷰 요청: 모달 표시
      showReviewRequestModal(prInfo, (updatedPrInfo) => {
        sendSlackNotification(updatedPrInfo, action);
      });
    } else {
      // 리뷰 완료: 확인 모달 표시
      showReviewCompleteModal(prInfo, () => {
        sendSlackNotification(prInfo, action);
      });
    }
  }

  // 버튼 삽입
  async function insertButton() {
    if (document.getElementById('reviewping-container')) {
      return;
    }

    const prInfo = getPRInfo();
    if (!prInfo) {
      console.log('[ReviewPing] Could not get PR info');
      return;
    }

    // 허용된 저장소인지 확인
    const allowed = await isRepoAllowed(prInfo.owner, prInfo.repo);
    if (!allowed) {
      console.log('[ReviewPing] Repository not in allowed list:', `${prInfo.owner}/${prInfo.repo}`);
      return;
    }

    console.log('[ReviewPing] Inserting floating button');

    const container = createFloatingButton(prInfo);
    document.body.appendChild(container);
  }

  // 지연 후 실행 (GitHub가 동적으로 콘텐츠 로드하므로)
  function initWithDelay() {
    setTimeout(() => {
      insertButton();
      // 초기 머지 상태 확인 (이미 머지된 PR에 진입한 경우)
      previousMergeState = isMerged();
    }, 1000);
  }

  // 페이지 로드 후 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWithDelay);
  } else {
    initWithDelay();
  }

  // GitHub의 SPA 네비게이션 대응
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;

      // 기존 버튼 제거
      const existing = document.getElementById('reviewping-container');
      if (existing) {
        existing.remove();
      }

      // 머지 상태 초기화
      previousMergeState = false;

      // PR 페이지면 새 버튼 삽입
      if (isPRPage()) {
        initWithDelay();
      }
    } else if (isPRPage()) {
      // 같은 페이지 내에서 DOM 변경 시 머지 상태 확인 (디바운싱)
      if (mergeCheckTimeout) {
        clearTimeout(mergeCheckTimeout);
      }
      mergeCheckTimeout = setTimeout(() => {
        checkMergeState();
      }, 1000); // 1초 디바운싱
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();
