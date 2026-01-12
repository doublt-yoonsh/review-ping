// ReviewPing - Background Script (Service Worker)

// 기본 템플릿
const DEFAULT_TEMPLATES = {
  request: `🔍 *리뷰 요청*
<{pr_url}|{pr_title}>
{reviewers} 리뷰 부탁드립니다! 🙏`,
  complete: `✅ *리뷰 완료*
<{pr_url}|{pr_title}>
{author} 리뷰 완료했습니다!`,
  merge: `🎉 *머지 완료*
<{pr_url}|{pr_title}>
{repo}에 머지되었습니다!`
};

// 설정 가져오기
async function getSettings() {
  return await chrome.storage.sync.get({
    connectionType: 'bot',
    botToken: '',
    channelId: '',
    webhookUrl: '',
    channelMappings: [],
    requestTemplate: DEFAULT_TEMPLATES.request,
    completeTemplate: DEFAULT_TEMPLATES.complete,
    mergeTemplate: DEFAULT_TEMPLATES.merge,
    mergeNotificationEnabled: true,
    userMappings: []
  });
}

// 저장소에 맞는 채널 찾기
function findChannelForRepo(repoFullName, channelMappings, connectionType) {
  if (!channelMappings || channelMappings.length === 0) {
    return null;
  }

  const repoLower = repoFullName.toLowerCase();
  const [owner] = repoLower.split('/');

  for (const mapping of channelMappings) {
    const pattern = mapping.repo.toLowerCase();

    // owner/* 패턴 (organization 전체)
    if (pattern.endsWith('/*')) {
      const mappingOwner = pattern.slice(0, -2);
      if (owner === mappingOwner) {
        return connectionType === 'bot' ? mapping.channelId : mapping.webhookUrl;
      }
    }
    // owner/repo 패턴 (특정 저장소)
    else if (repoLower === pattern) {
      return connectionType === 'bot' ? mapping.channelId : mapping.webhookUrl;
    }
  }

  return null;
}

// GitHub username → Slack mention 변환
function convertToSlackMention(username, userMappings) {
  const mapping = userMappings.find(m => m.github.toLowerCase() === username.toLowerCase());
  if (mapping) {
    return `<@${mapping.slack}>`;
  }
  return `@${username}`;
}

// 템플릿 변수 치환
function processTemplate(template, prInfo, settings, action) {
  const { userMappings } = settings;

  let message = template;

  // 기본 변수 치환
  message = message.replace(/{pr_title}/g, prInfo.title);
  message = message.replace(/{pr_url}/g, prInfo.url);
  message = message.replace(/{pr_number}/g, prInfo.prNumber);
  message = message.replace(/{repo}/g, `${prInfo.owner}/${prInfo.repo}`);

  // 작성자 멘션
  const authorMention = convertToSlackMention(prInfo.author, userMappings);
  message = message.replace(/{author}/g, authorMention);

  // 리뷰어 멘션 (리뷰 요청 시)
  if (action === 'request') {
    if (prInfo.reviewers && prInfo.reviewers.length > 0) {
      // PR 작성자(자기 자신)는 리뷰어 목록에서 제외
      const filteredReviewers = prInfo.reviewers.filter(
        r => r.toLowerCase() !== prInfo.author.toLowerCase()
      );

      if (filteredReviewers.length > 0) {
        const reviewerMentions = filteredReviewers
          .map(r => convertToSlackMention(r, userMappings))
          .join(' ');
        message = message.replace(/{reviewers}/g, reviewerMentions);
      } else {
        message = message.replace(/{reviewers}/g, '팀원분들');
      }
    } else {
      message = message.replace(/{reviewers}/g, '팀원분들');
    }
  }

  // 리뷰어 멘션 (리뷰 완료 시 - 현재 사용자)
  if (action === 'complete') {
    const reviewerMention = convertToSlackMention(prInfo.currentUser, userMappings);
    message = message.replace(/{reviewer}/g, reviewerMention);

    // 리뷰 코멘트가 있으면 상단 4줄을 코드 블럭으로 추가
    if (prInfo.reviewComment) {
      const lines = prInfo.reviewComment.split('\n').slice(0, 4);
      const commentPreview = lines.join('\n');
      message += `\n\`\`\`\n${commentPreview}\n\`\`\``;
    }
  }

  return message;
}

// Slack 메시지 전송 (fallback 지원)
async function sendSlackMessage(action, prInfo) {
  const settings = await getSettings();

  // 머지 알림이 비활성화된 경우
  if (action === 'merge' && !settings.mergeNotificationEnabled) {
    return { success: true, skipped: true };
  }

  // Bot Token 사용 가능 여부
  const canUseBotToken = settings.botToken && settings.channelId;
  // Webhook 사용 가능 여부
  const repoFullName = `${prInfo.owner}/${prInfo.repo}`;
  const repoWebhook = findChannelForRepo(repoFullName, settings.channelMappings, 'webhook');
  const canUseWebhook = repoWebhook || settings.webhookUrl;

  let primaryResult;
  let fallbackResult;

  // 연결 방식에 따라 primary/fallback 결정
  if (settings.connectionType === 'webhook') {
    // Primary: Webhook, Fallback: Bot Token
    if (canUseWebhook) {
      primaryResult = await sendViaWebhook(action, prInfo, settings);
      if (primaryResult.success) return primaryResult;
    }
    // Fallback to Bot Token
    if (canUseBotToken) {
      console.log('[ReviewPing] Webhook failed, trying Bot Token fallback...');
      fallbackResult = await sendViaBotToken(action, prInfo, settings);
      if (fallbackResult.success) return fallbackResult;
    }
  } else {
    // Primary: Bot Token, Fallback: Webhook
    if (canUseBotToken) {
      primaryResult = await sendViaBotToken(action, prInfo, settings);
      if (primaryResult.success) return primaryResult;
    }
    // Fallback to Webhook
    if (canUseWebhook) {
      console.log('[ReviewPing] Bot Token failed, trying Webhook fallback...');
      fallbackResult = await sendViaWebhook(action, prInfo, settings);
      if (fallbackResult.success) return fallbackResult;
    }
  }

  // 둘 다 실패한 경우
  const errorMsg = primaryResult?.error || fallbackResult?.error || '설정을 확인해주세요';
  return {
    success: false,
    error: `알림을 보내는데 실패했습니다. (${errorMsg})`
  };
}

// Bot Token 방식으로 전송
async function sendViaBotToken(action, prInfo, settings) {
  if (!settings.botToken) {
    return {
      success: false,
      error: 'Bot Token 필요'
    };
  }

  // 저장소에 맞는 채널 찾기 (없으면 기본 채널 사용)
  const repoFullName = `${prInfo.owner}/${prInfo.repo}`;
  const targetChannel = findChannelForRepo(repoFullName, settings.channelMappings, 'bot') || settings.channelId;

  if (!targetChannel) {
    return {
      success: false,
      error: '채널 ID 필요'
    };
  }

  // 템플릿 선택
  let template;
  if (action === 'request') {
    template = settings.requestTemplate;
  } else if (action === 'complete') {
    template = settings.completeTemplate;
  } else if (action === 'merge') {
    template = settings.mergeTemplate;
  }

  // 메시지 생성
  const message = processTemplate(template, prInfo, settings, action);

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel: targetChannel,
        text: message,
        unfurl_links: true,
        unfurl_media: true
      })
    });

    const data = await response.json();

    if (data.ok) {
      return { success: true };
    } else {
      console.error('Slack API Error:', data.error);
      return {
        success: false,
        error: getErrorMessage(data.error)
      };
    }
  } catch (error) {
    console.error('Network Error:', error);
    return {
      success: false,
      error: '네트워크 오류'
    };
  }
}

// Webhook 방식으로 전송
async function sendViaWebhook(action, prInfo, settings) {
  // 저장소에 맞는 Webhook URL 찾기 (없으면 기본 URL 사용)
  const repoFullName = `${prInfo.owner}/${prInfo.repo}`;
  const targetWebhook = findChannelForRepo(repoFullName, settings.channelMappings, 'webhook') || settings.webhookUrl;

  if (!targetWebhook) {
    return {
      success: false,
      error: 'Webhook URL 필요'
    };
  }

  // 템플릿 선택
  let template;
  if (action === 'request') {
    template = settings.requestTemplate;
  } else if (action === 'complete') {
    template = settings.completeTemplate;
  } else if (action === 'merge') {
    template = settings.mergeTemplate;
  }

  // 메시지 생성
  const message = processTemplate(template, prInfo, settings, action);

  try {
    const response = await fetch(targetWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: message
      })
    });

    if (response.ok) {
      return { success: true };
    } else {
      console.error('Webhook Error:', response.status, response.statusText);
      return {
        success: false,
        error: `전송 실패 (${response.status})`
      };
    }
  } catch (error) {
    console.error('Network Error:', error);
    return {
      success: false,
      error: '네트워크 오류'
    };
  }
}

// 에러 메시지 한글화
function getErrorMessage(error) {
  const errorMessages = {
    'channel_not_found': '채널을 찾을 수 없음',
    'not_in_channel': '봇이 채널에 없음',
    'invalid_auth': '잘못된 토큰',
    'token_revoked': '토큰이 취소됨',
    'no_permission': '권한 없음',
    'rate_limited': '요청 제한됨'
  };
  return errorMessages[error] || error;
}

// 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SEND_SLACK_MESSAGE') {
    const { action, prInfo } = request.payload;

    sendSlackMessage(action, prInfo)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));

    // 비동기 응답을 위해 true 반환
    return true;
  }

  if (request.type === 'TEST_WEBHOOK') {
    const { webhookUrl } = request.payload;

    testWebhook(webhookUrl)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }
});

// Webhook 테스트
async function testWebhook(webhookUrl) {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: '✅ ReviewPing Webhook 연결 테스트 성공!'
      })
    });

    if (response.ok) {
      return { success: true };
    } else {
      return { success: false, error: `${response.status} ${response.statusText}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 설치/업데이트 시 옵션 페이지 열기
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});
