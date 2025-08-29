import { PeerConnection, getFileInfo, appendMessage } from './lib.js'

if (navigator.wakeLock) navigator.wakeLock.request('screen')

export const LOCATION = new URL(location.href)
export const textInput = document.querySelector('#textInput')
export const header = document.querySelector('#header')
export const main = document.querySelector('#main')
export const textBox = document.querySelector('#textBox')
export const fileInput = document.querySelector('#fileInput')
export const sendBtn = document.querySelector('#sendBtn')
export const connectBtn = document.querySelector('#connectBtn')

window.history.replaceState({}, document.title, LOCATION.pathname)
document.querySelector('#logo').href = LOCATION.pathname

const PC = new PeerConnection(new URLSearchParams(LOCATION.search).get('code'))

fileInput.addEventListener('change', () => {
    if (!PC?.connection || !fileInput.files.length) return
    PC.send({ event: 'info', fileinfo: getFileInfo(fileInput.files[0]) })
})
textInput.addEventListener('keyup', (e) => e.key.includes('Enter') && sendText())
textInput.addEventListener('input', swapSendBtnImage)
sendBtn.addEventListener('click', sendText)
connectBtn.addEventListener('click', () => {
    const rpid = prompt('Remote ID:')
    if (!rpid) return
    PC.connectTo(rpid)
})

function sendText() {
    const message = textInput.value.trim()
    if (message === '') {
        if (sendBtn.matches('[data-disabled]')) return
        return fileInput.click()
    }
    textInput.value = ''
    swapSendBtnImage()
    appendMessage(message, true)
    PC.send({ event: 'message', message })
}

function swapSendBtnImage() {
    const txt = !!textInput.value
    sendBtn.setAttribute('data-icon', txt ? 'text' : 'file')
}

window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 0))
