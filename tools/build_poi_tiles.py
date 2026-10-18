"""Dựng bộ tiện ích Việt Nam từ Overture Maps (giấy phép CDLA-Permissive-2.0, dùng thương mại được).
Chạy hằng tháng khi Overture ra bản mới:
    python3 tools/build_poi_tiles.py <vn_places.parquet> <thư mục ra, ví dụ poi/>
File parquet lấy bằng DuckDB từ s3://overturemaps-us-west-2/release/<bản>/theme=places/type=place/
Mỗi ô 0,1 độ (~11 km) là một file JSON nhỏ: {"v":1,"p":[[lat,lng,"tên","nhóm","loại"],...]}
"""
import sys, os, re, json, math, unicodedata, collections
import duckdb

src, out = sys.argv[1], sys.argv[2]
rows = duckdb.connect().execute(f"select name, cat, conf, lat, lng from '{src}' where cc = 'VN'").fetchall()

def fold(s):
    s = unicodedata.normalize('NFD', s.lower()).replace('đ', 'd')
    return re.sub(r'[̀-ͯ]', '', s)
def accents(s):
    return sum(1 for ch in unicodedata.normalize('NFD', s) if '̀' <= ch <= 'ͯ') + s.lower().count('đ')

R = lambda p: re.compile(p, re.I)
SCHOOL_NAME = R(r'^(trường|truong)|mầm non|mam non|mẫu giáo|mau giao|nhà trẻ|tiểu học|tieu hoc|thcs|thpt|trung học|trung hoc|đại học|dai hoc|cao đẳng|cao dang|học viện|hoc vien|liên cấp|lien cap')
SCHOOL_BAD = R(r'english|language|training|consulting|center|centre|academy of|phòng giáo dục|sở giáo dục|dịch vụ công|bồi dưỡng chính trị|boi duong|lái xe|lai xe|ngoại ngữ|ngoai ngu|anh ngữ|anh ngu|tin học|tin hoc|nhà sách|đồng phục|dong phuc|luyện thi|gia sư|gia su|năng khiếu|nang khieu|âm nhạc|am nhac|piano|vẽ|dạy nghề lái|xe máy|cổng|ký túc|ktx|căn tin|canteen|photo|văn phòng phẩm')
SCHOOL_CATS = {'school','preschool','day_care_preschool','kindergarten','elementary_school','middle_school','high_school','private_school','public_school','college_university','education','vocational_and_technical_school','medical_school','campus_building'}
SCHOOL_EN = R(r'kindergarten|preschool|primary school|secondary school|high school|international school|university|college')
MED_BAD = R(r'căng da|thẩm mỹ|nhà khách|^khoa |^phòng (?!khám)|căn tin|nhà tang lễ|nhà xác|đối diện|gần bệnh|tổ yến')
GOV_BAD = R(r'^báo |đoàn thanh niên|công đoàn|^hội |câu lạc bộ|clb|nhà khách|^khoa |^trường|nhà công vụ|chi hội')
MED_NAME = R(r'bệnh viện|benh vien|^bv\b|phòng khám đa khoa|phong kham da khoa|trung tâm y tế|trung tam y te|trạm y tế|tram y te|nhà hộ sinh|viện tim|viện nhi')
MED_CATS = {'hospital','medical_center','clinic','doctors_office','pediatric_clinic','health_department','emergency_department','medical_service_organization','community_health_center','outpatient_care_facility','health_care','family_practice'}
CHAIN = R(r'siêu thị|sieu thi|trung tâm thương mại|tttm|vincom|aeon|lotte mart|emart|e-mart|go!|big c|bigc|mm mega|co\.?op ?(mart|food|xtra|smile)|coopmart|bách hóa xanh|bách hoá xanh|bach hoa xanh|winmart|vinmart|circle ?k|family ?mart|ministop|gs25|7-eleven|satra|kingfood|lan chi mart|bách hóa|lotte')
MALL = R(r'trung tâm thương mại|tttm|vincom|aeon|lotte|go!|big c|bigc|mm mega|emart|e-mart')
SHOP_CATS = {'supermarket','grocery_store','convenience_store','shopping_center','shopping_mall','department_store','shopping','food_and_beverage_store'}
MARKET = R(r'^(chợ|cho) (?!tốt|tot\b|online|sỉ online)')
CHO_BAD = R(r'thiết bị|thiet bi|vệ sinh|điện máy|điện thoại|xe máy|ô tô|oto|online|đồ cũ|sim |máy may|vật liệu|vật tư|gạch|sắt thép|nhà đất|real estate|bất động sản|bđs|bds|việc làm|mua bán|sỉ |thanh lý')
BAD_ALL = R(r'^(kho |kho$)|trung tâm phân phối|công ty|cty|văn phòng|vpgd|nhà phân phối|đại lý|apartment|căn hộ|chung cư|residence|\boffice\b|quán|cơm |cháo|phở|bún |cafe|cà phê|coffee|trà sữa|tiệm|\bshop\b|cửa hàng|homestay|khách sạn|nhà nghỉ|nhà trọ|giữ xe|parking|tổ yến|in ấn|photocopy|(tại|gần|đối diện|cạnh|trước|ngay|bên|sau|cổng) (bv|bệnh viện|trường|chợ)')
STORE_START = R(r'^(siêu thị|sieu thi|co\.?op ?(mart|food|xtra|smile)?|coopmart|bách hóa xanh|bách hoá xanh|bach hoa xanh|winmart|vinmart|lotte mart|aeon|go!|big ?c|emart|e-mart|mm mega|satra|kingfood|lan chi|circle ?k|family ?mart|ministop|gs25|7-eleven|trung tâm thương mại|tttm|vincom|giga mall|crescent mall|sc vivocity|vạn hạnh mall|takashimaya|parkson)')
MALL_START = R(r'^(trung tâm thương mại|tttm|vincom|aeon|lotte mart|go!|big ?c|emart|e-mart|mm mega|giga mall|crescent mall|sc vivocity|vạn hạnh mall|takashimaya|parkson)')
SHOP_BAD = R(r'điện máy|di động|thế giới|máy may|máy|thiết bị|vật liệu|nội thất|gạch|sơn|xe |xe$|điện thoại|laptop|máy tính|kính|thuốc|sữa|mẹ và bé|me va be|đồ gỗ|thời trang|giày|mỹ phẩm|điện tử|điện lạnh|nông sản|vật tư|bia|rượu|đồ chơi|thú cưng|pet|vải|chăn|nệm|xây dựng|tóc|mắt|nhựa|inox|điện nước')
GOV = R(r'ủy ban|uỷ ban|uy ban|ubnd|công an|cong an|kho bạc|kho bac|bảo hiểm xã hội|bhxh|chi cục thuế|chi cuc thue|đăng ký đất đai|trung tâm hành chính|hành chính công|một cửa|tòa án|toà án|toa an|viện kiểm sát|vien kiem sat|bưu điện|buu dien|bưu cục')
PARK = R(r'công viên|cong vien|vườn hoa|quảng trường|khu vui chơi|khu du lịch|sân vận động|san van dong|nhà thi đấu|nha thi dau|trung tâm (văn hóa|văn hoá|thể dục thể thao|tdtt)|nhà văn hóa|nhà văn hoá|nhà thiếu nhi|cung văn hóa|công viên nước')
PARK_BAD = R(r'giữ xe|bãi xe|khu dân cư|kdc|căn hộ|chung cư|nhà hàng|cafe|cà phê|karaoke|quán')
KCN = R(r'^(khu công nghiệp|khu cong nghiep|cụm công nghiệp|cum cong nghiep|khu chế xuất|khu che xuat|kcn|ccn|kcx)\b')
BUS = R(r'^(bến xe|ben xe)')
TRAIN = R(r'^ga |^nhà ga|^ga$')
FERRY = R(r'^(bến phà|ben pha|phà)')
BANK = R(r'ngân hàng|ngan hang|vietcombank|bidv|agribank|techcombank|vietinbank|sacombank|vpbank|tpbank|mb ?bank|acb\b|hdbank|shb|vib\b|ocb\b|eximbank|seabank|msb\b|lpbank|nam a bank|kienlongbank|abbank|pvcombank|bac a bank|vietbank|saigonbank|baoviet ?bank|scb\b')

def classify(name, cat, conf):
    n = name.strip()
    c = cat or ''
    if KCN.search(n) and not re.search(r'công ty|cty|nhà trọ|trạm xăng|cửa hàng|quán', n, re.I):
        return ('k', '') if conf >= 0.3 else None
    if BAD_ALL.search(n): return None
    if MARKET.search(n) and not CHO_BAD.search(n) and c not in ('restaurant','coffee_shop'):
        return ('c', 'm') if conf >= 0.3 else None
    if SCHOOL_NAME.search(n) or (c in SCHOOL_CATS and SCHOOL_EN.search(n)):
        if SCHOOL_BAD.search(n): return None
        return ('t', '') if conf >= (0.25 if SCHOOL_NAME.search(n) else 0.6) else None
    if MED_NAME.search(n) and (c in MED_CATS or conf >= 0.5 or c == '' ):
        if MED_BAD.search(n) or re.search(r'nhà thuốc|nha thuoc|thú y|thu y|nha khoa|thẩm mỹ|tham my|spa', n, re.I): return None
        kind = 'h' if re.search(r'bệnh viện|benh vien|^bv\b', n, re.I) else 'c'
        return ('y', kind) if conf >= 0.3 else None
    if STORE_START.search(n) and not SHOP_BAD.search(n) and conf >= 0.35:
        return ('c', 'l' if MALL_START.search(n) else 's')
    if GOV.search(n) and not GOV_BAD.search(n) and (c in ('town_hall','police_station','post_office','courthouse','community_and_government','government_office','government_services','public_service_and_government','social_or_community_service') or conf >= 0.5):
        return ('h', '') if conf >= 0.3 else None
    if PARK.search(n) and not PARK_BAD.search(n) and (c in ('park','stadium_arena','football_stadium','soccer_stadium','community_center','amusement_park','water_park','sport_or_fitness_facility','sports_complex') or conf >= 0.5):
        return ('p', '') if conf >= 0.35 else None
    if BUS.search(n) and c not in ('restaurant','coffee_shop'):
        return ('g', '') if conf >= 0.35 else None
    if (TRAIN.search(n) and c == 'train_station') or (FERRY.search(n) and conf >= 0.4):
        return ('g', '')
    if c in ('bank', 'bank_or_credit_union') and BANK.search(n) and not re.match(r'atm', n, re.I) and conf >= 0.4:
        return ('n', '')
    return None

ADDR = R(r'\d|\b(q\.|p\.|tp|tphcm|hcm|huyện|quận|phường|xã|đường|kp|ấp|tổ|thị trấn|tỉnh|thành phố|việt nam|vietnam)\b')
def clean_name(n):
    n = re.sub(r'\s+', ' ', n).strip(' -_|,.')
    parts = re.split(r'\s*[-–_|]\s+|\s+[-–_|]\s*|\s*,\s*|\s*\(', n, maxsplit=1)
    if len(parts) == 2 and len(parts[0].split()) >= 2 and ADDR.search(parts[1]):
        n = parts[0].strip(' -_|,.')
    letters = [ch for ch in n if ch.isalpha()]
    if letters and (sum(ch.isupper() for ch in letters) / len(letters) > 0.8 or n == n.lower()):
        n = ' '.join(w[:1].upper() + w[1:].lower() if not re.fullmatch(r'[A-Z0-9]{2,5}', w) or len(w) > 5 else w for w in n.split())
    return n

kept = []
for name, cat, conf, lat, lng in rows:
    if not name: continue
    name = clean_name(name)
    if len(name) < 4 or len(name) > 90: continue
    r = classify(name, cat, conf or 0)
    if r: kept.append([round(lat, 5), round(lng, 5), name, r[0], r[1], conf or 0])

# Bỏ trùng: cùng nhóm, tên giống nhau (bỏ dấu) trong 250 m -> giữ bản có dấu đầy đủ / độ tin cậy cao hơn
def km(a, b): return 111.32 * math.hypot(a[0] - b[0], (a[1] - b[1]) * math.cos(math.radians(a[0])))
grid = collections.defaultdict(list)
final = []
for p in sorted(kept, key=lambda p: (-accents(p[2]), -p[5])):
    key = (p[3], round(p[0] * 200), round(p[1] * 200))
    f = fold(p[2])
    dup = False
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for q in grid[(p[3], key[1] + dx, key[2] + dy)]:
                fq = fold(q[2])
                if (f == fq or f in fq or fq in f) and km(p, q) < 0.25: dup = True; break
            if dup: break
        if dup: break
    if dup: continue
    grid[key].append(p)
    final.append(p)

tiles = collections.defaultdict(list)
for p in final:
    tiles[f"{math.floor(p[1] * 10)}_{math.floor(p[0] * 10)}"].append(p[:5])
os.makedirs(out, exist_ok=True)
for f in os.listdir(out):
    if f.endswith('.json'): os.remove(os.path.join(out, f))
total = 0
for k, ps in tiles.items():
    s = json.dumps({'v': 1, 'p': ps}, ensure_ascii=False, separators=(',', ':'))
    total += len(s.encode())
    open(os.path.join(out, k + '.json'), 'w').write(s)
by = collections.Counter(p[3] for p in final)
print('giữ', len(kept), '-> sau bỏ trùng', len(final), '| ô', len(tiles), '| tổng', round(total / 1e6, 2), 'MB', '| nhóm', dict(by))
