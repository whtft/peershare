import { Peer } from './peerjs.min.js'

const chunk_size = 16_300
const max_buffer = 16_000_000 / 2

const LOCATION = new URL(location.href)
const main = document.querySelector('#main')
const textBox = document.querySelector('#textBox')
const fileInput = document.querySelector('#fileInput')
const fileInputLbl = document.querySelector('#fileInputLbl')

export class PeerConnection {
    peer
    connection
    /** @type {TransferElement} */
    download
    /** @type {TransferElement} */
    upload
    constructor(rpid) {
        this.peer = new Peer()
        this.peer.on('open', (pid) => this.onPeerOpen(pid, rpid))
        this.peer.on('connection', (conn) => this.onPeerConnection(conn))
    }
    onPeerOpen(pid, rpid) {
        console.log('PEER OPEN', pid)
        if (rpid) this.onPeerConnection(this.peer.connect(rpid, { reliable: true }))
        else this.appendQRCode(`${LOCATION.origin + LOCATION.pathname}?code=${pid}`)
    }
    onPeerConnection(conn) {
        main.replaceChildren()
        this.connection = conn
            .on('open', () => {
                disableUploadButton(false)
                hideTextBox(false)
                console.log('CONNECTION ESTABLISHED', this.connection.peer)
                this.connection.dataChannel.onmessage = (m) => this.onDataChannelMessage(m)
            })
            .on('close', () => {
                disableUploadButton(true)
                hideTextBox(true)
                console.log('CONNECTION CLOSED')
                if (main.matches(':empty')) {
                    this.appendQRCode(`${LOCATION.origin + LOCATION.pathname}?code=${this.peer.id}`)
                }
            })
            .on('error', (error) => {
                disableUploadButton(true)
                hideTextBox(true)
                console.log('CONNECTION ERROR')
                console.error(error)
            })
    }
    send(data) {
        if (data.chunk) this.connection.dataChannel.send(new Blob([data.index, data.chunk]))
        else this.connection.dataChannel.send(JSON.stringify(data))
    }
    async sendFile(file) {
        let start = 0
        const index = new Uint32Array([0])
        while (start < file.size) {
            if (this.upload.cancelled) return
            if (!this.connection.dataChannel) return this.upload.cancel()
            if (this.connection.dataChannel.bufferedAmount > max_buffer) {
                await new Promise((res) => setTimeout(res, 50))
                continue
            }

            const chunk = file.slice(start, start + chunk_size + 1)
            this.send({ index, chunk })
            start += chunk.size
            index[0]++

            this.upload.setProgress(Math.round((start / file.size) * 100))
            const ptext = `▲ ${formatBytes(start)} / ${formatBytes(file.size)}`
            this.upload.setInfos(ptext)
            // const bitrate = formatBytes(Math.round(start / (Date.now() - this.upload.ts)) * 1000) + '/s'
        }
    }
    onDataChannelMessage(message) {
        if (typeof message.data != 'string') this.dataHandler(message)
        else this.messageHandler(JSON.parse(message.data))
    }
    messageHandler(data) {
        if (data.event == 'info') {
            this.download = new TransferElement(data.fileinfo)
            this.download.oncancel = () => this.send({ event: 'cancel', dir: 'down' })
            this.download.setBusy(true)
            this.send({ event: 'ready' })
        } else if (data.event == 'ready') {
            this.upload = new TransferElement(getFileInfo(fileInput.files[0]))
            this.upload.oncancel = () => {
                this.send({ event: 'cancel', dir: 'up' })
                disableUploadButton(false)
            }
            this.sendFile(fileInput.files[0])
            this.upload.setBusy(true)
            disableUploadButton(true)
        } else if (data.event == 'end') {
            this.upload.setBusy(false)
            disableUploadButton(false)
            this.upload.setInfos(null, 'received')
        } else if (data.event == 'cancel') {
            if (data.dir == 'up') this.download.cancel()
            else {
                this.upload.cancel()
                disableUploadButton(false)
            }
        } else if (data.event == 'message') {
            appendMessage(data.message, false)
        }
    }
    dataHandler(message) {
        if (this.download.cancelled) return

        const index = new DataView(message.data.slice(0, 4)).getUint32(0, true)
        this.download.received += message.data.byteLength - 4
        this.download.fb[index] = message.data.slice(4)

        const percent = Math.round((this.download.received / this.download.fi.size) * 100)
        this.download.setProgress(percent)
        const ptext = `▼ ${formatBytes(this.download.received)} / ${formatBytes(this.download.fi.size)}`
        const bitrate = formatBytes(Math.round(this.download.received / (Date.now() - this.download.ts)) * 1000) + '/s'
        this.download.setInfos(ptext + ' - ' + bitrate)

        if (this.download.received == this.download.fi.size) {
            this.download.setBusy(false)
            this.download.setUrl(URL.createObjectURL(new Blob(this.download.fb, { type: this.download.fi.type })))
            this.send({ event: 'end' })
        }
    }
    appendQRCode(text) {
        const qr = document.createElement(LOCATION.protocol === 'https:' ? 'div' : 'a')
        qr.id = 'code'
        qr.href = text
        new QRCode(qr, { text, colorDark: '#13171f', correctLevel: QRCode.CorrectLevel.H })
        qr.title = ''
        qr.querySelectorAll('img, canvas').forEach((e) => (e.draggable = false))
        main.replaceChildren(qr)
    }
}

export function appendMessage(textContent, sender = false) {
    const messageEl = Object.assign(document.createElement('div'), { className: 'text-message', textContent })
    messageEl.classList.toggle('sender', sender)
    main.append(messageEl)
    messageEl.scrollIntoView()
}

export class TransferElement {
    #anchor
    #infosL
    #infosR
    #cancelBtn
    fb = []
    received = 0
    ts = Date.now()
    fi
    cancelled = false
    oncancel = () => {}
    constructor(fileInfo) {
        this.fi = fileInfo
        const wrapper = Object.assign(document.createElement('div'), { className: 'wrapper' })
        const infoWrapper = Object.assign(document.createElement('div'), { className: 'infos' })
        this.#infosL = document.createElement('div')
        this.#infosR = document.createElement('div')
        infoWrapper.append(this.#infosL, this.#infosR)
        this.#anchor = Object.assign(document.createElement('a'), {
            textContent: fileInfo.name,
            download: fileInfo.name,
            role: 'button',
            className: 'file-link secondary',
        })
        this.#cancelBtn = Object.assign(document.createElement('a'), { textContent: 'cancel' })
        this.#cancelBtn.addEventListener('click', (e) => {
            e.preventDefault()
            this.cancel()
            this.oncancel()
        })
        this.setInfos(null, this.#cancelBtn)
        wrapper.append(this.#anchor, infoWrapper)
        main.append(wrapper)
        wrapper.scrollIntoView()
    }
    cancel() {
        this.cancelled = true
        this.setInfos(null, 'cancelled')
        this.setBusy(false)
    }
    setInfos(left, right) {
        if (!isNill(left)) {
            if (typeof left == 'string') this.#infosL.textContent = left
            else this.#infosL.replaceChildren(left)
        }
        if (!isNill(right)) {
            if (typeof right == 'string') this.#infosR.textContent = right
            else this.#infosR.replaceChildren(right)
        }
    }
    setProgress(percent) {
        percent = Math.max(0, Math.min(100, percent))
        this.#anchor.style.setProperty('--percent', `${percent}%`)
    }
    setBusy(busy) {
        this.#anchor.setAttribute('aria-busy', busy)
        if (!busy) this.#cancelBtn.remove()
    }
    setUrl(url) {
        this.#anchor.href = url
        this.#anchor.classList.remove('secondary')
    }
}

function isNill(obj) {
    return obj === null || obj === undefined
}

function disableUploadButton(disable) {
    fileInputLbl.toggleAttribute('disabled', disable)
}

function hideTextBox(hidden) {
    textBox.toggleAttribute('hidden', hidden)
}

export function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = Math.max(0, decimals)
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(dm) + ' ' + sizes[i]
}

export function getFileInfo(file) {
    return { name: file.name, size: file.size, type: file.type }
}
