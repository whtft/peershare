const chunk_size = 16_300
const max_buffer = 16_000_000

const main = document.querySelector('article main')
const fileInput = document.querySelector('#fileInput')
const LOCATION = new URL(location.href)
const rid = new URLSearchParams(LOCATION.search).get('code')
window.history.replaceState({}, document.title, LOCATION.pathname)

if (navigator.wakeLock) navigator.wakeLock.request('screen')

let connection
/** @type {FileTransfer} */ let SND
/** @type {FileTransfer} */ let REC

const peer = new Peer().on('open', onPeerOpen).on('connection', onPeerConnection)

function onPeerOpen() {
    console.log('PEER OPEN')
    if (rid) onPeerConnection(peer.connect(rid, { reliable: true }))
    else appendQRCode(`${LOCATION.origin + LOCATION.pathname}?code=${peer.id}`)
}

function onPeerConnection(conn) {
    main.replaceChildren()
    connection = conn
        .on('open', () => {
            fileInput.disabled = false
            console.log('CONNECTION ESTABLISHED')
            connection.dataChannel.onmessage = onDataChannelMessage
        })
        .on('close', () => {
            fileInput.disabled = true
            console.log('CONNECTION CLOSED')
            if (main.matches(':empty')) {
                appendQRCode(`${LOCATION.origin + LOCATION.pathname}?code=${peer.id}`)
            }
        })
        .on('error', (error) => {
            fileInput.disabled = true
            console.log('CONNECTION ERROR:')
            console.log(error)
        })
}

function send(data) {
    if (data.chunk) connection.dataChannel.send(new Blob([data.index, data.chunk]))
    else connection.dataChannel.send(JSON.stringify(data))
}

class FileTransfer {
    anchor
    filebuffer = []
    received = 0
    ts = Date.now()
    fileInfo
    constructor(fileInfo, isSender) {
        this.fileInfo = fileInfo

        this.anchor = Object.assign(document.createElement('a'), {
            textContent: fileInfo.name,
            download: fileInfo.name,
            role: 'button',
            className: 'file-link',
        })
        // if (isSender)
        this.anchor.classList.add('secondary')
        main.append(this.anchor)
    }
    setProgress(percent) {
        percent = Math.max(0, Math.min(100, percent))
        this.anchor.style.setProperty('--percent', `${percent}%`)
    }
    onMessage(message) {
        const index = new DataView(message.data.slice(0, 4)).getUint32(0, true)

        this.received += message.data.byteLength - 4
        const percent = Math.round((this.received / this.fileInfo.size) * 100)
        this.setProgress(percent)
        const bitrate = formatBytes(Math.round(this.received / (Date.now() - this.ts)) * 1000) + '/s'
        const ptext = `${formatBytes(this.received)} / ${formatBytes(this.fileInfo.size)}`
        this.anchor.setAttribute('data-info', ptext)
        this.anchor.setAttribute('data-info2', bitrate)

        this.filebuffer[index] = message.data.slice(4)

        if (this.received == this.fileInfo.size) {
            this.anchor.classList.remove('secondary')
            this.anchor.setAttribute('data-info', ptext + ' ✓')
            this.anchor.href = URL.createObjectURL(new Blob(this.filebuffer, { type: this.fileInfo.type }))
            this.anchor.scrollIntoView()
            send({ event: 'file_end' })
        }
    }
    async sendFile(file) {
        let start = 0
        let index = new Uint32Array([0])
        while (start < file.size) {
            if (connection.dataChannel.bufferedAmount > max_buffer) {
                await new Promise((res) => setTimeout(res, 200))
                continue
            }
            const chunk = file.slice(start, start + chunk_size + 1)
            send({ index, chunk })
            start += chunk.size
            index[0]++

            const ptext = `${formatBytes(start)} / ${formatBytes(file.size)}`
            this.setProgress(Math.round((start / file.size) * 100))
            this.anchor.setAttribute('data-info', ptext)
        }
    }
}

function onDataChannelMessage(message) {
    if (typeof message.data != 'string') REC.onMessage(message)
    else messageHandler(JSON.parse(message.data))
}

function messageHandler(data) {
    if (data.event == 'file_info') {
        REC = new FileTransfer(data.fileinfo, false)
        send({ event: 'file_ready' })
    } else if (data.event == 'file_ready') {
        SND = new FileTransfer(getFileInfo(fileInput.files[0]), true)
        SND.sendFile(fileInput.files[0])
        fileInput.disabled = true
    } else if (data.event == 'file_end') {
        fileInput.disabled = false
    }
}

fileInput.addEventListener('change', () => {
    if (!connection) return
    if (!fileInput.files.length) return
    send({ event: 'file_info', fileinfo: getFileInfo(fileInput.files[0]) })
})

function getFileInfo(file) {
    return { name: file.name, size: file.size, type: file.type }
}

function appendQRCode(text) {
    const code = document.createElement('div')
    code.id = 'code'
    if (location.protocol != 'https:') {
        code.append(Object.assign(document.createElement('a'), { href: text, textContent: 'connect' }))
    }
    new QRCode(code, {
        text,
        width: 256,
        height: 256,
        colorDark: '#181c25',
        colorLight: '#fff',
        correctLevel: QRCode.CorrectLevel.H,
    })
    code.title = ''
    main.replaceChildren(code)
}

function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = Math.max(0, decimals)
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(dm) + ' ' + sizes[i]
}
