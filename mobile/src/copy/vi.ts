import type { CopyBundle } from '../i18n/apply';

/**
 * Tiếng Việt: the Vietnamese text of every string in `copy/strings.ts`.
 *
 * It has exactly the English bundle's shape - `CopyBundle` is that shape with every leaf a
 * plain string, so a missing or misspelt key does not compile - and `tests/i18n/` checks at
 * runtime that every key and every `{placeholder}` agrees with the English one.
 *
 * Conventions, so the app reads as one voice:
 *
 * - **Địa chỉ người dùng là "bạn"**, in a friendly but not slangy register. No "quý khách".
 * - **Tiền và chi tiêu**: an *expense* is `khoản chi` (the thing) or `chi tiêu` (the
 *   activity); *income* is `thu nhập` or `khoản thu`; *net* is `còn lại`; a *category* is
 *   `danh mục`; a *budget* is `ngân sách`; *recurring* is `định kỳ`.
 * - **Không có số nhiều.** Vietnamese does not inflect for number, so the singular and plural
 *   entries that English needs (`1 expense` / `{count} expenses`) are both present - the
 *   code picks between them by count - and read the same apart from the number.
 * - **Dấu câu**: sentences end in a full stop, labels and buttons do not, as in English
 *   (`docs/design/09-copy-deck.md` §0). Decimal examples use a comma (`40,50`), the
 *   Vietnamese mark, though the app accepts a point too.
 * - **Tên thương hiệu giữ nguyên**: `Expense Tracker`, `Face ID`, `CSV`.
 * - Placeholders (`{name}`, `{count}`, `{Month}`...) are copied exactly and may move within
 *   a sentence to wherever Vietnamese word order wants them.
 *
 * Written for this app and not yet reviewed by a native speaker: worth a pass before release,
 * especially the longer sentences (privacy, delete-account and sync copy).
 */

export const VIETNAMESE_COPY: CopyBundle = {
  COPY: {
    app: { name: 'Expense Tracker' },

    welcome: {
      tagline: 'Biết tiền của bạn đi đâu, dù có mạng hay không.',
      cta: { signup: 'Tạo tài khoản', login: 'Tôi đã có tài khoản' },
    },

    signup: {
      title: 'Tạo tài khoản của bạn',
      field: {
        email: 'Email',
        emailPlaceholder: 'ban@example.com',
        password: 'Mật khẩu',
        passwordHint: 'Ít nhất 8 ký tự',
        currency: 'Tiền tệ',
        currencyHint: 'Bạn không thể đổi sau này.',
      },
      submit: 'Tạo tài khoản',
      loginInstead: 'Đăng nhập',
    },

    login: { title: 'Chào mừng trở lại', submit: 'Đăng nhập', forgot: 'Quên mật khẩu?' },

    forgotPassword: {
      title: 'Đặt lại mật khẩu',
      hint: 'Nhập email của bạn và chúng tôi sẽ gửi mã gồm 6 chữ số.',
      submit: 'Gửi mã',
      offline: 'Bạn cần có mạng để đặt lại mật khẩu.',
    },
    resetPassword: {
      title: 'Nhập mã của bạn',
      hint: 'Nếu có tài khoản với {email}, chúng tôi đã gửi mã gồm 6 chữ số đến đó. Mã có hiệu lực trong 15 phút.',
      code: 'Mã',
      newPassword: 'Mật khẩu mới',
      submit: 'Đặt lại mật khẩu',
      resend: 'Gửi mã mới',
      resent: 'Nếu tài khoản tồn tại, một mã mới đang được gửi đi.',
      invalidCode: 'Mã không đúng hoặc đã hết hạn.',
      success: 'Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.',
      offline: 'Bạn cần có mạng để đặt lại mật khẩu.',
    },

    verifyEmail: {
      title: 'Xác minh email của bạn',
      hint: 'Chúng tôi đã gửi mã gồm 6 chữ số đến {email}. Mã có hiệu lực trong 15 phút.',
      code: 'Mã',
      submit: 'Xác minh',
      resend: 'Gửi mã mới',
      resent: 'Một mã mới đang được gửi đi.',
      invalidCode: 'Mã không đúng hoặc đã hết hạn.',
      success: 'Đã xác minh email.',
      offline: 'Bạn cần có mạng để xác minh email.',
    },

    password: { show: 'Hiện mật khẩu', hide: 'Ẩn mật khẩu' },

    home: {
      title: 'Chi tiêu',
      total: { current: 'Tổng tháng này', other: 'Tổng' },
      balance: { income: 'Thu nhập {amount}', net: 'Còn lại {amount}' },
      pace: 'Dự kiến {amount} trong tháng',
      private: 'Gồm {amount} riêng tư',
      incomeLabel: 'thu nhập',
      paidIn: 'đã trả {amount}',
      section: { today: 'Hôm nay', yesterday: 'Hôm qua' },
      fab: 'Thêm khoản chi',
      categoryReview: {
        title: 'Các danh mục của bạn đã sẵn sàng',
        body: 'Chúng tôi đã tạo sẵn một vài danh mục để bạn bắt đầu. Bạn có thể đổi tên, xóa hoặc thêm danh mục riêng bất cứ lúc nào.',
        review: 'Xem danh mục',
        dismiss: 'Để sau',
      },
      budgetAlert: {
        overOne: 'Vượt ngân sách',
        overMany: '{count} danh mục vượt ngân sách',
        nearOne: 'Gần hết ngân sách',
        nearMany: '{count} danh mục gần hết ngân sách',
        bodyOver: '{names}: chi tiêu đã vượt ngân sách tháng.',
        bodyNear: '{names}: đã dùng từ 80% ngân sách tháng trở lên.',
        and: '{names} và {last}',
        andMore: '{names} và {count} danh mục khác',
        open: 'Xem tổng quan',
        dismiss: 'Bỏ qua',
      },
      search: {
        open: 'Tìm khoản chi',
        close: 'Đóng tìm kiếm',
        placeholder: 'Tìm theo ghi chú và danh mục',
        clear: 'Xóa tìm kiếm',
        allCategories: 'Tất cả danh mục',
        private: 'Riêng tư',
        resultsOne: '1 kết quả',
        resultsMany: '{count} kết quả',
        empty: {
          headline: 'Không có kết quả',
          body: 'Không có gì khớp với tìm kiếm này. Hãy thử từ khác hoặc danh mục khác.',
        },
      },
    },

    summary: {
      title: 'Tổng quan',
      count: { many: '{count} khoản chi', one: '1 khoản chi' },
      trend: { title: '6 tháng gần nhất', spent: 'Đã chi', income: 'Thu nhập' },
      insights: {
        title: 'Nhận xét',
        up: 'Bạn đã chi nhiều hơn {percent}% so với {month}.',
        down: 'Bạn đã chi ít hơn {percent}% so với {month}.',
        same: 'Chi tiêu của bạn gần bằng {month}.',
        top: '{name} là danh mục bạn chi nhiều nhất, chiếm {percent}% trong tháng.',
        rise: '{name} tăng {amount} so với {month}.',
        incomeUp: 'Thu nhập của bạn tăng {percent}% so với {month}.',
        incomeDown: 'Thu nhập của bạn giảm {percent}% so với {month}.',
        incomeSame: 'Thu nhập của bạn gần bằng {month}.',
        kept: 'Tháng này bạn đã giữ lại {amount} từ thu nhập.',
        overspent: 'Tháng này bạn đã chi nhiều hơn thu nhập {amount}.',
      },
    },

    form: {
      private: {
        label: 'Giữ riêng tư',
        hint: 'Chỉ bạn nhìn thấy. Khoản này không tính vào tổng của người khác.',
      },
      title: {
        add: 'Thêm khoản chi',
        edit: 'Sửa khoản chi',
        addIncome: 'Thêm khoản thu',
        editIncome: 'Sửa khoản thu',
      },
      currency: { title: 'Tiền tệ', row: 'Tiền tệ' },
      rate: {
        label: 'Tỷ giá',
        hint: '1 {from} = {rate} {home}',
        converted: '= {amount}',
        loading: 'Đang lấy tỷ giá…',
        failed: 'Không lấy được tỷ giá hôm nay. Hãy tự nhập.',
        needed: 'Nhập tỷ giá.',
        invalid: 'Nhập tỷ giá như 1,0823.',
      },
      kind: { expense: 'Chi tiêu', income: 'Thu nhập' },
      field: {
        category: 'Danh mục',
        date: 'Ngày',
        note: 'Ghi chú',
        notePlaceholder: 'Thêm ghi chú (không bắt buộc)',
        receipt: 'Hóa đơn',
        receiptAdd: 'Thêm ảnh',
        receiptAttached: 'Đã đính kèm ảnh',
      },
      receipt: {
        title: 'Hóa đơn',
        take: 'Chụp ảnh',
        choose: 'Chọn từ thư viện',
        remove: 'Xóa ảnh',
        loading: 'Đang tải ảnh…',
        unavailable: 'Hãy kết nối mạng để xem ảnh này.',
        deniedCamera: 'Hãy cho phép dùng máy ảnh trong Cài đặt để chụp hóa đơn.',
        deniedLibrary: 'Hãy cho phép truy cập ảnh trong Cài đặt để đính kèm hóa đơn.',
        failed: 'Không dùng được ảnh đó. Hãy thử ảnh khác.',
        imageLabel: 'Ảnh hóa đơn',
        scan: {
          action: 'Đọc hóa đơn',
          hint: 'Gửi ảnh này lên máy chủ để tìm số tiền, ngày và cửa hàng.',
          reading: 'Đang đọc hóa đơn…',
          suggestionTitle: 'Từ hóa đơn',
          use: 'Dùng',
          dismiss: 'Bỏ qua',
          nothingFound: 'Không đọc được gì từ ảnh đó.',
          failed: 'Không đọc được hóa đơn đó. Hãy tự nhập thông tin.',
          unavailable: 'Hiện chưa đọc được hóa đơn.',
        },
      },
      save: 'Lưu',
      delete: 'Xóa khoản chi',
      deleteIncome: 'Xóa khoản thu',
      close: 'Đóng mà không lưu',
      date: { today: 'Hôm nay', yesterday: 'Hôm qua', choose: 'Chọn ngày…' },
      keypad: { decimal: 'Dấu thập phân', backspace: 'Xóa chữ số cuối' },
      noteDone: 'Xong',
      notFound: {
        headline: 'Không tìm thấy khoản chi',
        body: 'Có thể khoản chi đã bị xóa trên thiết bị khác.',
        action: 'Quay lại chi tiêu',
      },
    },

    picker: {
      category: { title: 'Danh mục', new: 'Danh mục mới' },
      month: { title: 'Chuyển đến tháng', thisMonth: 'Tháng này' },
    },

    categories: { title: 'Danh mục', fab: 'Thêm danh mục' },

    category: {
      new: { title: 'Danh mục mới' },
      edit: { title: 'Sửa danh mục' },
      field: {
        name: 'Tên',
        namePlaceholder: 'ví dụ: Cà phê',
        colour: 'Màu',
        budget: 'Ngân sách hằng tháng (không bắt buộc)',
        budgetPlaceholder: 'Không có ngân sách',
      },
      colour: { reserved: 'Màu này được dành riêng.', inUse: 'Đang dùng' },
      create: 'Tạo',
      save: 'Lưu',
      delete: 'Xóa danh mục',
    },

    common: {
      back: 'Quay lại',
      close: 'Đóng',
      cancel: 'Hủy',
      undo: 'Hoàn tác',
      view: 'Xem',
      delete: 'Xóa',
      tryAgain: 'Thử lại',
    },

    settings: {
      title: 'Cài đặt',
      email: 'Email',
      currency: 'Tiền tệ',
      currencyHint: 'Được chọn khi bạn tạo tài khoản.',
      categories: 'Danh mục',
      recurring: 'Chi tiêu định kỳ',
      recurringHint: 'Tiền nhà, gói đăng ký và các khoản định kỳ.',
      goals: 'Mục tiêu tiết kiệm',
      goalsHint: 'Tiết kiệm cho điều bạn muốn.',
      household: 'Hộ gia đình',
      tabBar: 'Thanh tab',
      displayName: 'Tên hiển thị',
      householdHint: 'Chia sẻ sổ chi tiêu với người khác.',
      renameCategories: 'Đổi tên danh mục mặc định',
      renameCategoriesHint: 'Chuyển tên gốc sang tiếng Việt.',
      appearance: 'Giao diện',
      export: 'Xuất khoản chi',
      exportHint: 'Lưu mọi thứ bạn đã ghi thành tệp CSV.',
      verifyEmail: 'Xác minh email',
      unverified: 'Chưa xác minh',
      changePassword: 'Đổi mật khẩu',
      deleteAccount: 'Xóa tài khoản',
      logout: 'Đăng xuất',
    },

    appearance: {
      title: 'Giao diện',
      system: 'Theo hệ thống',
      light: 'Sáng',
      dark: 'Tối',
    },

    lock: {
      title: 'Expense Tracker đã khóa',
      body: 'Mở khóa để xem các khoản chi của bạn.',
      unlock: 'Mở khóa',
      reason: 'Mở khóa Expense Tracker',
      enableReason: 'Bật khóa ứng dụng',
      disableReason: 'Tắt khóa ứng dụng',
      failed: 'Không mở khóa được. Hãy thử lại.',
      notConfirmed: 'Không xác nhận được đó là bạn, nên khóa ứng dụng không thay đổi.',
      unavailable: 'Hãy thiết lập Face ID, vân tay hoặc mật mã trên thiết bị này trước.',
      settingsRow: 'Khóa ứng dụng',
      settingsHint: 'Yêu cầu Face ID hoặc mật mã.',
    },

    tabBarStyle: {
      title: 'Kiểu thanh tab',
      compact: 'Gọn',
      wide: 'Rộng',
      labelled: 'Có nhãn',
      hint: {
        compact: 'Một thanh nhỏ nổi ở giữa.',
        wide: 'Trải rộng toàn màn hình, mỗi tab một ô như nhau.',
        labelled: 'Trải rộng toàn màn hình, có tên dưới mỗi biểu tượng.',
      },
    },
    /** Shared households (`docs/design/10-households.md`). */
    household: {
      title: 'Hộ gia đình',
      empty: {
        headline: 'Chia sẻ sổ chi tiêu',
        body: 'Dùng chung một sổ chi tiêu với người thân hoặc gia đình. Ai cũng xem và thêm được mọi thứ.',
      },
      create: 'Tạo hộ gia đình',
      join: 'Tham gia bằng mã',
      createConfirm: {
        title: 'Tạo hộ gia đình?',
        body: 'Các khoản chi hiện tại của bạn sẽ chuyển vào hộ gia đình và được chia sẻ với những người bạn mời. Nếu sau này bạn rời đi, chúng vẫn ở lại với hộ gia đình.',
        confirm: 'Tạo',
      },
      memberSheet: {
        transfer: 'Chuyển quyền chủ hộ',
        remove: 'Xóa khỏi hộ gia đình',
      },
      transfer: {
        title: 'Chuyển quyền chủ hộ cho {email}?',
        body: 'Họ có thể mời và xóa người, và xóa hộ gia đình. Bạn trở thành thành viên và có thể rời đi.',
        confirm: 'Chuyển quyền',
      },
      addedBy: 'Thêm bởi {name}',
      addedByYou: 'Bạn đã thêm',
      bulk: {
        selectAction: 'Chọn khoản chi',
        select: 'Chọn khoản chi',
        selectedNone: 'Chưa chọn',
        selectedOne: 'Đã chọn 1',
        selectedMany: 'Đã chọn {count}',
        makePrivate: 'Chuyển sang riêng tư',
        makeShared: 'Chuyển sang chung',
        madePrivateOne: '1 khoản chi đã chuyển sang riêng tư.',
        madePrivateMany: '{count} khoản chi đã chuyển sang riêng tư.',
        madeSharedOne: '1 khoản chi đã chuyển sang chung.',
        madeSharedMany: '{count} khoản chi đã chuyển sang chung.',
      },
      members: 'Thành viên',
      role: {
        owner: 'Chủ hộ',
        member: 'Thành viên',
      },
      you: 'Bạn',
      invite: {
        action: 'Mời thêm người',
        title: 'Mã mời',
        body: 'Chia sẻ mã này. Mã dùng được một lần, trong 48 giờ.',
        share: 'Chia sẻ mã',
        message: 'Tham gia hộ gia đình của mình trên Expense Tracker bằng mã này: {code}',
        close: 'Đóng',
      },
      joinSheet: {
        title: 'Tham gia hộ gia đình',
        field: 'Mã mời',
        hint: 'Bạn sẽ thấy sổ chi tiêu của hộ gia đình. Khoản chi riêng của bạn vẫn được giữ kín và quay lại nếu bạn rời đi.',
        submit: 'Tham gia',
      },
      leave: {
        action: 'Rời hộ gia đình',
        title: 'Rời hộ gia đình này?',
        body: 'Bạn sẽ quay lại với các khoản chi riêng của mình. Hộ gia đình giữ lại những gì mọi người đã thêm.',
        confirm: 'Rời đi',
      },
      delete: {
        action: 'Xóa hộ gia đình',
        title: 'Xóa hộ gia đình này?',
        body: 'Mọi người quay lại với các khoản chi riêng. Bạn giữ lại các khoản chi chung.',
        confirm: 'Xóa',
      },
      remove: {
        title: 'Xóa {email} khỏi hộ gia đình?',
        body: 'Họ sẽ quay lại với các khoản chi riêng của mình.',
        confirm: 'Xóa khỏi hộ',
      },
      syncFirst: 'Hãy đồng bộ các thay đổi trước. Kết nối internet rồi thử lại.',
      offline: 'Hãy kết nối internet để quản lý hộ gia đình.',
      retry: 'Thử lại',
      snack: {
        created: 'Đã tạo hộ gia đình.',
        joined: 'Bạn đã tham gia hộ gia đình.',
        left: 'Bạn đã rời hộ gia đình.',
        removed: 'Đã xóa thành viên.',
        transferred: 'Đã chuyển quyền chủ hộ.',
        deleted: 'Đã xóa hộ gia đình.',
      },
      a11y: {
        removeMember: 'Xóa {email}',
        memberActions: 'Tùy chọn cho {email}',
      },
      error: {
        invalid_invite_code: 'Mã không đúng hoặc đã hết hạn.',
        household_exists: 'Bạn đã ở trong một hộ gia đình.',
        not_in_household: 'Bạn chưa ở trong hộ gia đình nào.',
        household_owner_only: 'Chỉ chủ hộ mới làm được việc này.',
        owner_cannot_leave: 'Chủ hộ không thể rời đi. Hãy xóa hộ gia đình thay vào đó.',
        household_has_members:
          'Hãy chuyển quyền chủ hộ hoặc xóa hộ gia đình trước khi xóa tài khoản.',
      },
    },
    goals: {
      title: 'Mục tiêu tiết kiệm',
      fab: 'Thêm mục tiêu tiết kiệm',
      reminder: {
        weekTitle: 'Mục tiêu đến hạn sau một tuần',
        dayTitle: 'Mục tiêu đến hạn vào ngày mai',
        body: '{name} · còn {remaining}',
      },
      new: { title: 'Mục tiêu tiết kiệm mới' },
      edit: { title: 'Sửa mục tiêu tiết kiệm' },
      field: {
        name: 'Tên',
        target: 'Mục tiêu',
        saved: 'Đã tiết kiệm',
        deadline: 'Hạn chót (không bắt buộc)',
        deadlinePlaceholder: 'Không có',
      },
      deposit: {
        title: 'Thêm vào {name}',
        amount: 'Số tiền',
        add: 'Thêm',
        editGoal: 'Sửa mục tiêu',
      },
      row: {
        amounts: '{saved} trên {target}',
        reached: 'Đã đạt mục tiêu',
        perMonth: 'Tiết kiệm {amount} mỗi tháng để đạt mục tiêu trước {date}',
        pastDeadline: 'Hạn chót là {date}',
      },
      error: {
        name: 'Nhập tên cho mục tiêu này.',
        nameLong: 'Tên này quá dài.',
        amount: 'Nhập số tiền như 500 hoặc 499,99.',
        date: 'Nhập ngày như 2026-12-31.',
      },
      empty: {
        headline: 'Chưa có mục tiêu tiết kiệm',
        body: 'Đặt mục tiêu cho một chuyến đi, một chiếc laptop hay quỹ dự phòng, rồi thêm tiền vào khi bạn tiết kiệm được.',
      },
      create: 'Thêm',
      save: 'Lưu',
      delete: 'Xóa mục tiêu tiết kiệm',
      deleteDialog: {
        title: 'Xóa mục tiêu này?',
        body: 'Mục tiêu và tiến độ của nó sẽ bị xóa. Các khoản chi của bạn không bị ảnh hưởng.',
      },
    },

    recurring: {
      title: 'Chi tiêu định kỳ',
      fab: 'Thêm chi tiêu định kỳ',
      new: { title: 'Chi tiêu định kỳ mới' },
      edit: { title: 'Sửa chi tiêu định kỳ' },
      field: {
        amount: 'Số tiền',
        category: 'Danh mục',
        note: 'Ghi chú (không bắt buộc)',
        frequency: 'Lặp lại',
        startDate: 'Bắt đầu',
        endDate: 'Kết thúc (không bắt buộc)',
        datePlaceholder: 'YYYY-MM-DD',
        endPlaceholder: 'Không bao giờ',
      },
      frequency: { weekly: 'Hằng tuần', monthly: 'Hằng tháng' },
      hint: {
        pastStart: 'Ngày bắt đầu trong quá khứ sẽ thêm các khoản chi bạn đã bỏ lỡ.',
      },
      error: {
        amount: 'Nhập số tiền như 12 hoặc 12,99.',
        date: 'Nhập ngày như 2026-11-05.',
        endBeforeStart: 'Ngày kết thúc không thể trước ngày bắt đầu.',
        noCategory: 'Hãy thêm danh mục trước.',
      },
      row: { next: 'Tiếp theo {date}', ended: 'Đã kết thúc' },
      reminder: { title: 'Đến hạn ngày mai', body: '{name} · {amount}' },
      create: 'Thêm',
      save: 'Lưu',
      delete: 'Xóa chi tiêu định kỳ',
      deleteDialog: {
        title: 'Xóa chi tiêu định kỳ này?',
        body: 'Các khoản chi đã được thêm sẽ được giữ lại. Sẽ không thêm khoản nào mới nữa.',
      },
      empty: {
        headline: 'Chưa có chi tiêu định kỳ',
        body: 'Thêm một khoản và ứng dụng sẽ tự tạo khoản chi cho bạn mỗi tuần hoặc mỗi tháng, kể cả khi không có mạng.',
      },
    },

    export: {
      busy: 'Đang chuẩn bị tệp của bạn',
      empty: 'Chưa có khoản chi nào để xuất.',
      unavailable: 'Thiết bị này không hỗ trợ chia sẻ tệp.',
      failed: 'Không xuất được các khoản chi của bạn. Hãy thử lại.',
    },

    account: {
      changePassword: {
        title: 'Đổi mật khẩu',
        hint: 'Bạn sẽ bị đăng xuất khỏi các thiết bị khác.',
        current: 'Mật khẩu hiện tại',
        new: 'Mật khẩu mới',
        confirm: 'Xác nhận mật khẩu mới',
        submit: 'Đổi mật khẩu',
        mismatch: 'Mật khẩu không khớp.',
        same: 'Hãy chọn mật khẩu khác với mật khẩu hiện tại.',
        success: 'Đã đổi mật khẩu.',
        offline: 'Bạn cần có mạng để đổi mật khẩu.',
      },
      displayName: {
        title: 'Tên hiển thị',
        field: 'Tên',
        hint: 'Đây là tên những người trong hộ gia đình của bạn nhìn thấy. Để trống để hiển thị phần đầu của email.',
        save: 'Lưu',
        saved: 'Đã lưu tên.',
        none: 'Chưa đặt',
        tooLong: 'Tên có thể dài tối đa 40 ký tự.',
        offline: 'Bạn cần có mạng để đổi tên.',
      },
      changeEmail: {
        title: 'Đổi email',
        hint: 'Đây là địa chỉ bạn dùng để đăng nhập.',
        new: 'Email mới',
        password: 'Mật khẩu',
        submit: 'Đổi email',
        same: 'Đó đã là email của bạn.',
        taken: 'Email này đã được đăng ký.',
        success: 'Đã đổi email.',
        offline: 'Bạn cần có mạng để đổi email.',
      },
      deleteAccount: {
        title: 'Xóa tài khoản',
        warning:
          'Thao tác này xóa vĩnh viễn tài khoản của bạn cùng mọi khoản chi và danh mục trong đó, trên thiết bị này và trên máy chủ của chúng tôi. Không thể hoàn tác.',
        password: 'Mật khẩu',
        submit: 'Xóa tài khoản của tôi',
        dialogTitle: 'Xóa tài khoản của bạn?',
        dialogBody:
          'Mọi thứ sẽ mất vĩnh viễn. Hãy xuất các khoản chi trước nếu bạn muốn giữ một bản sao.',
        confirm: 'Xóa tài khoản',
        offline: 'Bạn cần có mạng để xóa tài khoản.',
      },
      wrongPassword: 'Mật khẩu không đúng.',
      tooManyAttempts: 'Quá nhiều lần thử. Hãy thử lại sau giây lát.',
    },

    logout: {
      title: 'Đăng xuất?',
      bodyClean: 'Bạn có thể đăng nhập lại bất cứ lúc nào.',
      bodyPending: 'Những thay đổi chưa đồng bộ sẽ bị mất.',
      confirm: 'Đăng xuất',
    },

    error: { generic: 'Đã xảy ra lỗi từ phía chúng tôi. Hãy thử lại.' },
    session: { expired: 'Phiên đăng nhập của bạn đã hết hạn. Vui lòng đăng nhập lại.' },

    categoryRename: {
      title: 'Đổi tên {count} danh mục?',
      body: 'Chỉ đổi những tên gốc bạn chưa sửa, trên mọi thiết bị của bạn.',
      confirm: 'Đổi tên',
      dismiss: 'Để sau',
    },

    language: {
      title: 'Ngôn ngữ',
      system: 'Theo hệ thống',
      en: 'English',
      vi: 'Tiếng Việt',
    },

    currencyNames: {
      USD: 'Đô la Mỹ',
      EUR: 'Euro',
      GBP: 'Bảng Anh',
      JPY: 'Yên Nhật',
      CAD: 'Đô la Canada',
      AUD: 'Đô la Úc',
      CHF: 'Franc Thụy Sĩ',
      INR: 'Rupee Ấn Độ',
      BRL: 'Real Brazil',
      MXN: 'Peso Mexico',
    },

    a11y: {
      jumpToMonth: 'Nhấn đúp để chuyển sang tháng khác.',
      editExpense: 'Nhấn đúp để sửa khoản chi này.',
      deleteExpense: 'Xóa khoản chi',
      payInOtherCurrency: 'Nhấn đúp để trả bằng loại tiền khác.',
      typeRate: 'Nhấn đúp để tự nhập tỷ giá.',
      changeCategory: 'Nhấn đúp để đổi danh mục.',
      editCategory: 'Nhấn đúp để sửa danh mục này.',
      editRecurring: 'Nhấn đúp để sửa chi tiêu định kỳ này.',
      addToGoal: 'Nhấn đúp để thêm tiền vào mục tiêu này.',
      deleteNamed: 'Xóa {name}',
      previousMonth: 'Tháng trước, {month}',
      nextMonth: 'Tháng sau, {month}',
      previousYear: 'Năm trước, {year}',
      nextYear: 'Năm sau, {year}',
      amount: 'Số tiền, {amount}',
      doubleTapToChange: 'Nhấn đúp để thay đổi.',
      notSyncedYet: 'chưa đồng bộ',
      private: 'riêng tư',
      couldNotSync: 'không đồng bộ được',
      cannotBeDeleted: 'không thể xóa',
      noExpenses: 'Không có khoản chi',
      expenseOne: '1 khoản chi',
      expenseMany: '{count} khoản chi',
    },

    notFound: {
      headerTitle: 'Không tìm thấy',
      title: 'Màn hình này không tồn tại.',
      action: 'Về trang đầu',
    },
    boot: { title: 'Expense Tracker không khởi động được' },
  },

  VALIDATION_COPY: {
    email: {
      empty: 'Nhập địa chỉ email của bạn.',
      invalid: 'Nhập địa chỉ email hợp lệ.',
    },
    password: {
      empty: 'Nhập mật khẩu của bạn.',
      short: 'Dùng ít nhất 8 ký tự.',
      long: 'Dùng tối đa 128 ký tự.',
    },
    category: {
      empty: 'Nhập tên.',
      duplicate: 'Bạn đã có danh mục tên "{name}".',
      budgetFormat: 'Nhập số tiền như 40 hoặc 40,50.',
    },
    amount: {
      zero: 'Nhập số tiền lớn hơn 0.',
      max: 'Đó là số tiền lớn nhất bạn có thể nhập.',
      outOfRange: 'Số tiền này nằm ngoài phạm vi cho phép.',
    },
    nochange: 'Hãy thay đổi gì đó để lưu.',
    nocategories: 'Hãy thêm danh mục trước.',
  },

  OFFLINE_COPY: {
    signup: 'Bạn cần có mạng để tạo tài khoản.',
    login: 'Bạn cần có mạng để đăng nhập.',
  },

  EMPTY_COPY: {
    home: {
      firstRun: {
        headline: 'Chưa có khoản chi nào',
        body: 'Thêm khoản chi đầu tiên và nó sẽ hiện ở đây, cùng tổng chi tiêu hằng tháng.',
        action: 'Thêm khoản chi đầu tiên',
      },
      month: {
        headline: 'Không có gì trong {Month}',
        body: 'Bạn chưa ghi khoản chi nào cho tháng này.',
        action: 'Đến {CurrentMonth}',
      },
    },
    categoryPicker: { headline: 'Chưa có danh mục', action: 'Tạo danh mục' },
    summary: {
      headline: 'Chưa có gì để tổng hợp',
      body: 'Thêm một khoản chi trong tháng này và bạn sẽ thấy tiền của mình đã đi đâu.',
    },
  },

  CONFIRM_COPY: {
    discard: {
      title: 'Bỏ các thay đổi?',
      body: 'Các chỉnh sửa của bạn sẽ không được lưu.',
      confirm: 'Bỏ',
      cancel: 'Tiếp tục sửa',
    },
    categoryDelete: {
      title: 'Xóa {name}?',
      bodyMany:
        '{count} khoản chi của danh mục này sẽ chuyển sang {fallbackName}. Chúng sẽ không bị xóa.',
      bodyOne:
        '1 khoản chi của danh mục này sẽ chuyển sang {fallbackName}. Khoản chi đó sẽ không bị xóa.',
      bodyNone: 'Danh mục này chưa có khoản chi nào.',
      blocked:
        'Không thể xóa {fallbackName}. Đây là nơi các khoản chi chuyển đến khi bạn xóa một danh mục.',
    },
  },

  SNACK_COPY: {
    expense: {
      saved: 'Đã lưu khoản chi.',
      savedOtherMonth: 'Đã lưu khoản chi vào {Month} năm {Year}.',
      updated: 'Đã lưu thay đổi.',
      deleted: 'Đã xóa khoản chi.',
      restored: 'Đã khôi phục khoản chi.',
    },
    goal: {
      saved: 'Đã lưu mục tiêu tiết kiệm.',
      deposited: 'Đã thêm vào mục tiêu của bạn.',
      deleted: 'Đã xóa mục tiêu tiết kiệm.',
    },
    recurring: {
      saved: 'Đã lưu chi tiêu định kỳ.',
      deleted: 'Đã xóa chi tiêu định kỳ.',
    },
    category: {
      created: 'Đã tạo {name}.',
      updated: 'Đã cập nhật {name}.',
      deletedMany: 'Đã xóa {name}. {count} khoản chi đã chuyển sang {fallbackName}.',
      deletedOne: 'Đã xóa {name}. 1 khoản chi đã chuyển sang {fallbackName}.',
      deletedNone: 'Đã xóa {name}.',
      defaultsRenamed: 'Đã đổi tên danh mục.',
      blocked:
        'Không thể xóa {fallbackName}. Đây là nơi các khoản chi chuyển đến khi bạn xóa một danh mục.',
    },
    amount: { max: 'Đó là số tiền lớn nhất bạn có thể nhập.' },
    month: { current: 'Đây là tháng hiện tại.' },
  },

  SYNC_COPY: {
    pill: {
      syncing: 'Đang đồng bộ…',
      pending: '{n} đang chờ',
      offline: 'Ngoại tuyến',
      offlinePending: 'Ngoại tuyến · {n} đang chờ',
      error: 'Đồng bộ thất bại',
    },
    a11y: {
      syncing: 'Đang đồng bộ các thay đổi của bạn.',
      pendingMany: '{n} thay đổi đang chờ đồng bộ. Nhấn đúp để xem chi tiết.',
      pendingOne: '1 thay đổi đang chờ đồng bộ. Nhấn đúp để xem chi tiết.',
      offline:
        'Ngoại tuyến. Các thay đổi của bạn được lưu trên thiết bị này. Nhấn đúp để xem chi tiết.',
      offlinePendingMany: 'Ngoại tuyến, {n} thay đổi đang chờ đồng bộ. Nhấn đúp để xem chi tiết.',
      offlinePendingOne: 'Ngoại tuyến, 1 thay đổi đang chờ đồng bộ. Nhấn đúp để xem chi tiết.',
      error: 'Đồng bộ thất bại. Nhấn đúp để xem chi tiết.',
    },
    sheet: {
      title: 'Đồng bộ',
      syncing: { headline: 'Đang đồng bộ', body: 'Đang cập nhật các khoản chi của bạn.' },
      idle: { headline: 'Đã cập nhật', body: 'Mọi thứ trên thiết bị này đã được đồng bộ.' },
      pending: {
        headline: 'Đang chờ đồng bộ',
        body: 'Các thay đổi của bạn đã được lưu trên thiết bị này và sẽ sớm được đồng bộ.',
      },
      offline: {
        headline: 'Ngoại tuyến',
        body: 'Các thay đổi của bạn đã được lưu trên thiết bị này và sẽ tự động đồng bộ khi bạn có mạng trở lại.',
      },
      error: {
        headline: 'Đồng bộ thất bại',
        body: 'Chúng tôi không kết nối được với máy chủ. Các thay đổi của bạn vẫn an toàn trên thiết bị này.',
      },
      waitingMany: '{count} thay đổi đang chờ',
      waitingOne: '1 thay đổi đang chờ',
      waitingMore: 'và {count} thay đổi khác',
      added: 'Đã thêm',
      edited: 'Đã sửa',
      deleted: 'Đã xóa',
      lastSynced: 'Đồng bộ lần cuối {relative}',
      lastSyncedNever: 'Chưa đồng bộ',
    },
    row: { needsAttention: 'Không đồng bộ được — nhấn để sửa' },
    resync: {
      title: 'Đang cập nhật',
      body: 'Bạn đã lâu không dùng ứng dụng, nên chúng tôi đang làm mới các khoản chi của bạn từ đầu. Việc này chỉ mất một lúc.',
    },
  },

  RELATIVE_TIME_COPY: {
    justNow: 'vừa xong',
    minutesAgo: '{n} phút trước',
    minuteAgo: '1 phút trước',
    hoursAgo: '{n} giờ trước',
    hourAgo: '1 giờ trước',
    daysAgo: '{n} ngày trước',
    dayAgo: '1 ngày trước',
    onDate: 'vào {date}',
  },
};
