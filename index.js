const chunk_size = 16_300
const max_buffer = 16_000_000

const main = document.querySelector('article main')
const fileInput = document.querySelector('#fileInput')
const PBAR = document.querySelector('#progress')
const progressInfo = document.querySelector('#progressInfo')
const LOCATION = new URL(location.href)
const rid = new URLSearchParams(LOCATION.search).get('code')
window.history.replaceState({}, document.title, LOCATION.pathname)

if (navigator.wakeLock) navigator.wakeLock.request('screen')

let filebuffer, received, ts
let connection = null

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

function onDataChannelMessage(message) {
    if (typeof message.data != 'string') chunkHandler(message)
    else messageHandler(JSON.parse(message.data))
}

function messageHandler(data) {
    if (data.event == 'file_info') {
        fileinfo = data.fileinfo
        send({ event: 'file_ready' })
    } else if (data.event == 'file_ready') {
        send({ event: 'file_start' })
        fileInput.disabled = true
        sendFile()
    } else if (data.event == 'file_start') {
        filebuffer = []
        received = 0
        ts = Date.now()
        fileInput.disabled = true
    } else if (data.event == 'file_end') {
        fileInput.disabled = false
    }
}

function chunkHandler(message) {
    const index = new DataView(message.data.slice(0, 4)).getUint32(0, true)

    received += message.data.byteLength - 4
    const progress = Math.round((received / fileinfo.size) * 100)
    PBAR.style.width = progress + '%'
    const bitrate = formatBytes(Math.round(received / (Date.now() - ts)) * 1000) + '/s'
    const ptext = `${formatBytes(received)} / ${formatBytes(fileinfo.size)} - ${bitrate}`
    progressInfo.textContent = ptext

    filebuffer[index] = message.data.slice(4)

    if (received == fileinfo.size) {
        const a = document.createElement('a')
        a.role = 'button'
        a.textContent = fileinfo.name
        a.download = fileinfo.name
        a.href = href = URL.createObjectURL(new Blob(filebuffer, { type: fileinfo.type }))
        main.append(a)
        a.scrollIntoView()
        filebuffer = null
        send({ event: 'file_end' })
        fileInput.disabled = false
    }
}

async function sendFile() {
    let start = 0
    let index = new Uint32Array([0])
    const file = fileInput.files[0]
    while (start < file.size) {
        if (connection.dataChannel.bufferedAmount > max_buffer) {
            await new Promise((res) => setTimeout(res, 200))
            continue
        }
        send({ index, _: index[0]++, chunk: file.slice(start, (start += chunk_size + 1)) })
        const progress = Math.round((start / file.size) * 100)
        PBAR.style.width = progress + '%'
        const ptext = `${formatBytes(start)} / ${formatBytes(file.size)}`
        progressInfo.textContent = ptext
    }
}

fileInput.addEventListener('change', () => {
    if (!connection) return
    if (!fileInput.files.length) return
    const file = fileInput.files[0]
    send({ event: 'file_info', fileinfo: { name: file.name, size: file.size, type: file.type } })
})

function appendQRCode(text) {
    const code = document.createElement('div')
    code.id = 'code'
    // code.append(Object.assign(document.createElement('a'), { href: text, textContent: 'connect' }))
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
