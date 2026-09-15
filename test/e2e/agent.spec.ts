import { test, expect, type Page } from '@playwright/test'

// Replace only the transport boundary. The real Vue UI, Pinia state, Muya,
// CodeMirror, review validation and undo paths run unchanged in the browser.
const transportFixture = `
let handler; let active; let timers = [];
let config = {baseUrl:'https://api.deepseek.com',model:'deepseek-flash',hasKey:false};
export const agentTransport = {
  getConfig: async()=>({...config}),
  saveConfig: async(settings, apiKey)=>{config={...settings,hasKey:apiKey === '' ? false : !!apiKey || config.hasKey};return {...config}},
  testConnection: async()=>{},
  listen: async(fn)=>{handler=fn;return ()=>{handler=null}},
  start: async(request)=>{
    active=request.requestId;
    const text=request.messages.at(-1).content;
    const send=(event)=>handler?.({requestId:request.requestId,...event});
    if(text==='wait') return;
    if(text==='error'){timers.push(setTimeout(()=>send({kind:'error',text:'agent:auth'}),20));return;}
    const oldText = request.context?.markdown.includes('hello world') ? 'hello world' : request.context?.markdown || '';
    timers.push(setTimeout(()=>send({kind:'tool',text:'read_document'}),20));
    timers.push(setTimeout(()=>send({kind:'delta',text:'这里是 **更自然的表达**。<img src="https://invalid.example/tracker"><script>alert(1)</script>'}),50));
    if(request.context)timers.push(setTimeout(()=>send({kind:'proposal',proposal:{title:'润色文字',oldText,newText:'Hello, world!'}}),80));
    timers.push(setTimeout(()=>send({kind:'done'}),120));
  },
  cancel: async(id)=>{timers.forEach(clearTimeout);timers=[];handler?.({requestId:id,kind:'cancelled'})},
};`

async function setup(page: Page, source = false) {
  await page.route('**/src/services/agent-transport.ts', route => route.fulfill({ contentType: 'text/javascript', body: transportFixture }))
  await page.goto('/')
  await page.locator('.muya-host [contenteditable="true"]').waitFor()
  await page.evaluate(async source => {
    const editorPath = '/src/stores/editor.ts', prefsPath = '/src/stores/preferences.ts', localePath = '/src/i18n/index.ts'
    const { useEditorStore } = await import(editorPath)
    const { usePreferencesStore } = await import(prefsPath)
    const { setLocale } = await import(localePath)
    Object.assign(usePreferencesStore(), { language:'zh-CN', theme:'light', autoSave:false, sideBarVisibility:false })
    setLocale('zh-CN')
    const editor = useEditorStore()
    const tab = editor.newUntitledTab('# 写作笔记\n\nhello world\n')
    tab.filename = '写作笔记.md'; tab.pendingBaselineUpdate = false
    editor.tabs = [tab]
    editor.sourceCodeMode = source
  }, source)
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await expect(page.getByRole('heading', { name:'一起把想法写好' })).toBeVisible()
}

async function send(page: Page, text = 'polish') {
  await page.getByRole('textbox', { name: '发送给写作助手的消息' }).fill(text)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}
async function markdown(page: Page) {
  return page.evaluate(async () => { const path='/src/stores/editor.ts'; return (await import(path)).useEditorStore().currentFile.markdown })
}

for (const source of [false, true]) {
  test(`reviews edits and integrates undo in ${source ? 'source' : 'wysiwyg'} mode`, async ({ page }) => {
    await setup(page, source)
    const original = await markdown(page)
    await send(page)
    const apply = page.getByRole('button', { name:'应用修改' })
    await expect(apply).toBeEnabled()
    expect(await markdown(page)).toBe(original)
    await expect(page.locator('.agent-markdown img, .agent-markdown script')).toHaveCount(0)
    await expect(page.locator('.agent-markdown strong')).toHaveText('更自然的表达')
    await apply.click()
    await expect.poll(() => markdown(page)).toContain('Hello, world!')
    await page.getByRole('button', { name:'撤回', exact: true }).click()
    await expect.poll(() => markdown(page)).toBe(original)
    // Generate a fresh edit, apply it, then use the editor's native undo path.
    await page.getByRole('button', { name:'新对话' }).click()
    await send(page)
    await expect(apply).toBeEnabled()
    await apply.click()
    await expect.poll(() => markdown(page)).toContain('Hello, world!')
    await page.evaluate(async () => { const path='/src/bus.ts'; const {bus}=await import(path);bus.emit('undo',undefined) })
    await expect.poll(() => markdown(page)).toBe(original)
  })
}

test('protects concurrent edits and supports cancellation, retry and settings', async ({ page }) => {
  await setup(page)
  await send(page)
  await expect(page.getByRole('button', { name:'应用修改' })).toBeEnabled()
  await page.evaluate(async () => {const path='/src/stores/editor.ts';const editor=(await import(path)).useEditorStore();editor.setMarkdownExternal(editor.currentFileId,'My own edit')})
  await page.getByRole('button', { name:'应用修改' }).click()
  await expect(page.locator('.agent-composer-error')).toContainText('文档已变化')
  expect((await markdown(page)).trim()).toBe('My own edit')
  await page.getByRole('button', { name:'新对话' }).click()
  await send(page, 'wait')
  await page.getByRole('button', { name:'停止生成' }).click()
  await expect(page.getByText('已停止生成', { exact:true })).toBeVisible()
  await page.getByRole('button', { name:'新对话' }).click()
  await send(page, 'error')
  await expect(page.locator('.agent-message .agent-error')).toContainText('身份验证失败')
  await page.getByRole('button', { name:'模型设置', exact:true }).click()
  await page.getByLabel('API Key').fill('test-only-placeholder')
  await page.getByRole('button', { name:'保存并测试' }).click()
  await expect(page.getByText('连接成功，模型已响应')).toBeVisible()
  await expect(page.getByLabel('API Key')).toHaveValue('')
  await page.getByRole('button', { name:'删除此服务的已存密钥' }).click()
  await expect(page.getByText('此服务的密钥已删除')).toBeVisible()
})

test('fits light/dark and narrow windows with selection context and per-document chats', async ({ page }) => {
  await setup(page, true)
  await page.locator('.source-pane .cm-content').click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.getByRole('button', { name:'附加编辑器选中内容' }).click()
  await expect(page.locator('.agent-context-row label')).toContainText('选中内容')
  await send(page)
  await expect(page.getByRole('button', { name:'应用修改' })).toBeEnabled()
  for (const width of [1280, 1024, 780, 540]) {
    await page.setViewportSize({ width, height:800 })
    for (const dark of [false, true]) {
      await page.evaluate(dark => {document.documentElement.classList.toggle('dark',dark);document.documentElement.dataset.theme=dark?'dark':'light'},dark)
      await expect(page.getByRole('button', { name:'发送', exact:true })).toBeInViewport()
      const overflow = await page.locator('.agent-panel').evaluate(element => element.scrollWidth > element.clientWidth + 1)
      expect(overflow).toBe(false)
      if (width === 1280 || width === 540) await page.screenshot({path:`output/agent/agent-${width}-${dark?'dark':'light'}.png`})
    }
  }
  await page.evaluate(async()=>{const path='/src/stores/editor.ts';(await import(path)).useEditorStore().newUntitledTab('another document')})
  await expect(page.locator('.agent-message')).toHaveCount(0)
  await page.getByRole('button', { name:'AI 助手', exact:true }).click()
  await page.keyboard.press('Control+Shift+A')
  await expect(page.locator('.agent-panel')).toBeVisible()
})
